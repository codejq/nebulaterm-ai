// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod secure_storage;

use ssh2::{Session, Channel};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::Arc;
use parking_lot::Mutex;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::Window;
use std::thread;
use std::time::Duration;

// Use portable-pty for all platforms (cross-platform PTY support)
use portable_pty::{CommandBuilder, PtySize, native_pty_system, PtyPair, Child};

// PTY Session enum - supports both SSH and local PTY
enum PtySessionType {
    Ssh {
        session: Session,
        channel: Option<Channel>,
    },
    Local {
        pty_pair: Arc<Mutex<PtyPair>>,
        writer: Arc<Mutex<Box<dyn Write + Send>>>,
        #[allow(dead_code)]
        child: Box<dyn Child + Send>,
    },
}

// PTY Session structure
struct PtySession {
    session_type: PtySessionType,
}

// Global PTY sessions storage
static PTY_SESSIONS: Lazy<Arc<Mutex<HashMap<String, Arc<Mutex<PtySession>>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

#[derive(Debug, Serialize, Deserialize)]
struct ConnectionParams {
    session_id: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    ssh_key_path: Option<String>,
    ssh_key_passphrase: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PtyWriteParams {
    session_id: String,
    data: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PtyResizeParams {
    session_id: String,
    cols: u32,
    rows: u32,
}

#[tauri::command]
async fn pty_connect(params: ConnectionParams, window: Window) -> Result<String, String> {
    let tcp = TcpStream::connect(format!("{}:{}", params.host, params.port))
        .map_err(|e| format!("Failed to connect to {}:{} - {}", params.host, params.port, e))?;

    let mut sess = Session::new()
        .map_err(|e| format!("Failed to create SSH session: {}", e))?;

    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH handshake failed: {}", e))?;

    // Set keepalive to prevent connection timeout (send keepalive every 60 seconds)
    sess.set_keepalive(true, 60);

    // Authentication
    if let Some(key_path) = params.ssh_key_path {
        let passphrase = params.ssh_key_passphrase.as_deref();
        sess.userauth_pubkey_file(
            &params.username,
            None,
            Path::new(&key_path),
            passphrase,
        )
        .map_err(|e| format!("SSH key authentication failed: {}", e))?;
    } else if let Some(password) = params.password {
        sess.userauth_password(&params.username, &password)
            .map_err(|e| format!("Password authentication failed: {}", e))?;
    } else {
        return Err("No authentication method provided".to_string());
    }

    if !sess.authenticated() {
        return Err("Authentication failed".to_string());
    }

    // Open PTY channel (in blocking mode first)
    let mut channel = sess.channel_session()
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    // Request PTY with default terminal size (80x24)
    channel.request_pty("xterm-256color", None, Some((80, 24, 0, 0)))
        .map_err(|e| format!("Failed to request PTY: {}", e))?;

    // Start shell
    channel.shell()
        .map_err(|e| format!("Failed to start shell: {}", e))?;

    // NOW set session to non-blocking mode for async I/O in background thread
    sess.set_blocking(false);

    let pty_session = Arc::new(Mutex::new(PtySession {
        session_type: PtySessionType::Ssh {
            session: sess,
            channel: Some(channel),
        },
    }));

    // Store session
    PTY_SESSIONS.lock().insert(params.session_id.clone(), pty_session.clone());

    // Start background thread to stream output
    let session_id_clone = params.session_id.clone();
    let window_clone = window.clone();
    thread::spawn(move || {
        let mut buffer = vec![0u8; 32768]; // Even larger buffer (32KB)
        loop {
            // Check if session still exists and get Arc clone with minimal lock time
            let pty_session_arc = {
                let sessions = PTY_SESSIONS.lock();
                if let Some(arc) = sessions.get(&session_id_clone) {
                    arc.clone()
                } else {
                    break;
                }
            };

            // Continuously drain until WouldBlock
            loop {
                let bytes_read = {
                    let mut pty = pty_session_arc.lock();
                    match &mut pty.session_type {
                        PtySessionType::Ssh { channel, .. } => {
                            if let Some(ref mut ch) = channel {
                                match ch.read(&mut buffer) {
                                    Ok(n) => n,
                                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                        // No more data available right now
                                        break;
                                    },
                                    Err(e) => {
                                        // Connection error - emit disconnect event
                                        let _ = window_clone.emit("pty-disconnect", serde_json::json!({
                                            "session_id": session_id_clone,
                                            "error": format!("Connection lost: {}", e)
                                        }));
                                        return; // Exit thread on error
                                    }
                                }
                            } else {
                                return; // Exit thread if no channel
                            }
                        },
                        _ => {
                            // Local PTY types don't use this thread
                            return;
                        }
                    }
                };

                if bytes_read > 0 {
                    let data = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                    let _ = window_clone.emit("pty-output", serde_json::json!({
                        "session_id": session_id_clone,
                        "data": data
                    }));
                } else {
                    break;
                }
            }

            // Sleep briefly after draining all available data
            thread::sleep(Duration::from_micros(500));
        }
    });

    Ok(format!("Connected to {}@{}:{}", params.username, params.host, params.port))
}

#[derive(Debug, Serialize, Deserialize)]
struct LocalPtyParams {
    session_id: String,
    cols: u16,
    rows: u16,
}

// Cross-platform local PTY implementation using portable-pty
#[tauri::command]
async fn pty_connect_local(params: LocalPtyParams, window: Window) -> Result<String, String> {
    let pty_system = native_pty_system();

    let pty_pair = pty_system
        .openpty(PtySize {
            rows: params.rows,
            cols: params.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Spawn shell (cmd.exe on Windows, default shell on Unix)
    let shell = if cfg!(windows) {
        "cmd.exe"
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()).leak() as &str
    };

    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(std::env::current_dir().map_err(|e| format!("Failed to get current dir: {}", e))?);

    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Extract writer once and store it
    let writer = pty_pair.master.take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;
    let writer_arc = Arc::new(Mutex::new(writer));

    let pty_arc = Arc::new(Mutex::new(pty_pair));

    let pty_session = Arc::new(Mutex::new(PtySession {
        session_type: PtySessionType::Local {
            pty_pair: pty_arc.clone(),
            writer: writer_arc,
            child: child,
        },
    }));

    // Store session
    PTY_SESSIONS.lock().insert(params.session_id.clone(), pty_session.clone());

    // Start background thread to stream output
    let session_id_clone = params.session_id.clone();
    let window_clone = window.clone();

    // Get a reader from the master PTY
    let mut reader = {
        let pty_pair = pty_arc.lock();
        pty_pair.master.try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?
    };

    thread::spawn(move || {
        let mut buffer = vec![0u8; 8192];

        loop {
            // Check if session still exists
            {
                let sessions = PTY_SESSIONS.lock();
                if !sessions.contains_key(&session_id_clone) {
                    break;
                }
            }

            let read_result = reader.read(&mut buffer);

            match read_result {
                Ok(0) => {
                    let _ = window_clone.emit("pty-disconnect", serde_json::json!({
                        "session_id": session_id_clone,
                        "error": "Shell process has exited"
                    }));
                    break;
                },
                Ok(bytes_read) => {
                    let text = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                    let _ = window_clone.emit("pty-output", serde_json::json!({
                        "session_id": session_id_clone,
                        "data": text
                    }));
                },
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // No data available, sleep briefly
                    thread::sleep(Duration::from_millis(10));
                },
                Err(e) => {
                    let _ = window_clone.emit("pty-disconnect", serde_json::json!({
                        "session_id": session_id_clone,
                        "error": format!("Local PTY error: {}", e)
                    }));
                    break;
                }
            }
        }
    });

    Ok("Local terminal connected".to_string())
}

#[tauri::command]
async fn pty_write(params: PtyWriteParams) -> Result<(), String> {
    let sessions = PTY_SESSIONS.lock();
    let pty_session = sessions.get(&params.session_id)
        .ok_or_else(|| "Session not found. Please connect first.".to_string())?;

    let mut pty = pty_session.lock();
    match &mut pty.session_type {
        PtySessionType::Ssh { channel, .. } => {
            if let Some(ref mut ch) = channel {
                ch.write_all(params.data.as_bytes())
                    .map_err(|e| format!("Failed to write to PTY: {}", e))?;
                ch.flush()
                    .map_err(|e| format!("Failed to flush PTY: {}", e))?;
                Ok(())
            } else {
                Err("Channel not available".to_string())
            }
        },
        PtySessionType::Local { writer, .. } => {
            let mut w = writer.lock();
            w.write_all(params.data.as_bytes())
                .map_err(|e| format!("Failed to write to PTY: {}", e))?;
            Ok(())
        }
    }
}

#[tauri::command]
async fn pty_resize(params: PtyResizeParams) -> Result<(), String> {
    let sessions = PTY_SESSIONS.lock();
    let pty_session = sessions.get(&params.session_id)
        .ok_or_else(|| "Session not found. Please connect first.".to_string())?;

    let mut pty = pty_session.lock();
    match &mut pty.session_type {
        PtySessionType::Ssh { channel, .. } => {
            if let Some(ref mut ch) = channel {
                ch.request_pty_size(params.cols, params.rows, None, None)
                    .map_err(|e| format!("Failed to resize PTY: {}", e))?;
                Ok(())
            } else {
                Err("Channel not available".to_string())
            }
        },
        PtySessionType::Local { pty_pair, .. } => {
            let pair = pty_pair.lock();
            pair.master.resize(PtySize {
                rows: params.rows as u16,
                cols: params.cols as u16,
                pixel_width: 0,
                pixel_height: 0,
            }).map_err(|e| format!("Failed to resize PTY: {}", e))?;
            Ok(())
        }
    }
}

#[tauri::command]
async fn pty_disconnect(session_id: String) -> Result<String, String> {
    let mut sessions = PTY_SESSIONS.lock();

    if let Some(pty_session) = sessions.remove(&session_id) {
        let mut pty = pty_session.lock();
        match &mut pty.session_type {
            PtySessionType::Ssh { session, channel } => {
                if let Some(mut ch) = channel.take() {
                    let _ = ch.close();
                    let _ = ch.wait_close();
                }
                let _ = session.disconnect(None, "Client disconnecting", None);
            },
            PtySessionType::Local { .. } => {
                // Local PTY will be cleaned up when dropped
            }
        }
        Ok("Disconnected successfully".to_string())
    } else {
        Err("Session not found".to_string())
    }
}

#[tauri::command]
async fn pty_check_connection(session_id: String) -> Result<bool, String> {
    let sessions = PTY_SESSIONS.lock();
    Ok(sessions.contains_key(&session_id))
}

// Secure Storage Commands

#[tauri::command]
async fn init_secure_storage(_app: tauri::AppHandle) -> Result<(), String> {
    // Get the executable's directory for portable database storage
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get executable path: {}", e))?;

    let app_dir = exe_path.parent()
        .ok_or("Failed to get executable parent directory")?;

    let db_path = app_dir.join("nebulaterm.db");
    secure_storage::init_database(db_path)?;
    Ok(())
}

#[tauri::command]
async fn has_master_password() -> Result<bool, String> {
    secure_storage::with_database(|db| {
        db.has_master_password()
            .map_err(|e| format!("Database error: {}", e))
    })
}

#[tauri::command]
async fn set_master_password(password: String) -> Result<(), String> {
    secure_storage::with_database(|db| {
        db.set_master_password(&password)
    })
}

#[tauri::command]
async fn unlock_database(password: String) -> Result<(), String> {
    secure_storage::with_database(|db| {
        db.unlock(&password)
    })
}

#[tauri::command]
async fn is_database_unlocked() -> Result<bool, String> {
    secure_storage::with_database(|db| {
        Ok(db.is_unlocked())
    })
}

#[derive(Debug, Serialize, Deserialize)]
struct StoreCredentialParams {
    id: String,
    name: String,
    username: Option<String>,
    password: Option<String>,
    ssh_key_path: Option<String>,
    passphrase: Option<String>,
}

#[tauri::command]
async fn store_credential(params: StoreCredentialParams) -> Result<(), String> {
    secure_storage::with_database(|db| {
        db.store_credential(
            &params.id,
            &params.name,
            params.username.as_deref(),
            params.password.as_deref(),
            params.ssh_key_path.as_deref(),
            params.passphrase.as_deref(),
        )
    })
}

#[derive(Debug, Serialize, Deserialize)]
struct DecryptedCredential {
    name: String,
    username: Option<String>,
    password: Option<String>,
    ssh_key_path: Option<String>,
    passphrase: Option<String>,
}

#[tauri::command]
async fn get_credential(id: String) -> Result<DecryptedCredential, String> {
    secure_storage::with_database(|db| {
        let stored = db.get_credential(&id)?;

        let password = db.decrypt_password(stored.password_encrypted)?;
        let passphrase = db.decrypt_password(stored.passphrase_encrypted)?;

        Ok(DecryptedCredential {
            name: stored.name,
            username: stored.username,
            password,
            ssh_key_path: stored.ssh_key_path,
            passphrase,
        })
    })
}

#[tauri::command]
async fn delete_credential(id: String) -> Result<(), String> {
    secure_storage::with_database(|db| {
        db.delete_credential(&id)
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pty_connect,
            pty_connect_local,
            pty_write,
            pty_resize,
            pty_disconnect,
            pty_check_connection,
            init_secure_storage,
            has_master_password,
            set_master_password,
            unlock_database,
            is_database_unlocked,
            store_credential,
            get_credential,
            delete_credential
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
    NativeSsh {
        pty_pair: Arc<Mutex<PtyPair>>,
        writer: Arc<Mutex<Box<dyn Write + Send>>>,
        #[allow(dead_code)]
        child: Box<dyn Child + Send>,
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
    ssh_key_content: Option<String>,
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

// Native SSH Connection (uses system ssh command)
async fn connect_with_native_ssh(params: ConnectionParams, window: Window) -> Result<String, String> {
    let key_path = params.ssh_key_path.as_ref().unwrap();

    // Build SSH command
    let cmd_args = vec![
        format!("{}@{}", params.username, params.host),
        "-p".to_string(),
        params.port.to_string(),
        "-i".to_string(),
        key_path.clone(),
        "-o".to_string(),
        "StrictHostKeyChecking=no".to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
    ];

    // Create PTY
    let pty_system = portable_pty::native_pty_system();
    let pty_pair = pty_system.openpty(portable_pty::PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| format!("Failed to create PTY: {}", e))?;

    // Spawn SSH command
    let mut cmd = portable_pty::CommandBuilder::new("ssh");
    for arg in cmd_args {
        cmd.arg(arg);
    }

    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn SSH: {}", e))?;

    let reader = pty_pair.master.try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
    let writer = pty_pair.master.take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let pty_pair_arc = Arc::new(Mutex::new(pty_pair));
    let writer_arc = Arc::new(Mutex::new(writer));

    let pty_session = Arc::new(Mutex::new(PtySession {
        session_type: PtySessionType::NativeSsh {
            pty_pair: pty_pair_arc.clone(),
            writer: writer_arc.clone(),
            child,
        },
    }));

    PTY_SESSIONS.lock().insert(params.session_id.clone(), pty_session.clone());

    // Start background thread to stream output
    let session_id_clone = params.session_id.clone();
    let window_clone = window.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut reader = reader;
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let data = String::from_utf8_lossy(&buf[0..n]).to_string();
                    let _ = window_clone.emit("pty-output", serde_json::json!({
                        "session_id": session_id_clone,
                        "data": data
                    }));
                },
                Ok(_) => {
                    // EOF - SSH process terminated or connection closed
                    let _ = window_clone.emit("pty-disconnect", serde_json::json!({
                        "session_id": session_id_clone,
                        "error": "Connection closed by remote host"
                    }));
                    break;
                },
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                    continue;
                },
                Err(e) => {
                    let _ = window_clone.emit("pty-disconnect", serde_json::json!({
                        "session_id": session_id_clone,
                        "error": format!("Connection lost: {}", e)
                    }));
                    break;
                }
            }
        }
    });

    Ok("Connected via native SSH".to_string())
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

    // Check if we should use native SSH (for ED25519 keys or Windows)
    #[cfg(windows)]
    let use_native_ssh = params.ssh_key_path.is_some();
    #[cfg(not(windows))]
    let use_native_ssh = false;

    if use_native_ssh && params.ssh_key_path.is_some() {
        // Use native SSH command for better key compatibility
        return connect_with_native_ssh(params, window).await;
    }

    // Authentication - Try key file path first, then key content, then password
    if let Some(ref key_path) = params.ssh_key_path {
        // Verify the key file exists
        if !Path::new(key_path).exists() {
            return Err(format!("SSH key file not found: {}", key_path));
        }

        let passphrase = params.ssh_key_passphrase.as_deref();

        // Generate public key file path (libssh2 needs it for some key types)
        let pub_key_path = format!("{}.pub", key_path);
        let pub_key_exists = Path::new(&pub_key_path).exists();

        // If public key doesn't exist, generate it
        if !pub_key_exists {
            let output = std::process::Command::new("ssh-keygen")
                .arg("-y")
                .arg("-f")
                .arg(key_path)
                .output();

            if let Ok(out) = output {
                if out.status.success() {
                    std::fs::write(&pub_key_path, out.stdout).ok();
                }
            }
        }

        // Try with public key file first, fall back to None
        let pub_key_opt = if Path::new(&pub_key_path).exists() {
            Some(Path::new(&pub_key_path))
        } else {
            None
        };

        let auth_result = sess.userauth_pubkey_file(
            &params.username,
            pub_key_opt,
            Path::new(key_path),
            passphrase,
        );

        if let Err(e) = auth_result {
            let code = e.code();
            let msg = e.message();

            // Check if this is an ed25519 key (common issue on Windows)
            let is_ed25519 = if let Some(pub_key) = pub_key_opt {
                std::fs::read_to_string(pub_key)
                    .ok()
                    .map(|content| content.contains("ssh-ed25519"))
                    .unwrap_or(false)
            } else {
                false
            };

            let error_msg = if is_ed25519 {
                format!(
                    "ED25519 key authentication failed. Windows libssh2 has limited ed25519 support.\n\
                    \nWorkaround: Generate an RSA key instead:\n  \
                    ssh-keygen -t rsa -b 4096 -f mykey\n\
                    \nThen import the RSA key into NebulaTerm.\n\
                    \nTechnical error: [{}] {}",
                    code, msg
                )
            } else {
                format!(
                    "SSH key file authentication failed for '{}':\n[{}] {}\n\
                    \nTroubleshooting:\n\
                    - Ensure the public key is added to the server's ~/.ssh/authorized_keys\n\
                    - Verify the key has the correct permissions\n\
                    - Try using an RSA key if using ed25519",
                    key_path, code, msg
                )
            };

            return Err(error_msg);
        }
    } else if let Some(ref password) = params.password {
        sess.userauth_password(&params.username, password)
            .map_err(|e| format!(
                "Password authentication failed for user '{}': {}",
                params.username, e
            ))?;
    } else {
        return Err("No authentication method provided. Please configure a password or SSH key.".to_string());
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
                    // EOF - remote side closed the connection
                    let _ = window_clone.emit("pty-disconnect", serde_json::json!({
                        "session_id": session_id_clone,
                        "error": "Connection closed by remote host"
                    }));
                    return; // Exit thread on EOF
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
        PtySessionType::NativeSsh { writer, .. } => {
            let mut w = writer.lock();
            w.write_all(params.data.as_bytes())
                .map_err(|e| format!("Failed to write to PTY: {}", e))?;
            w.flush()
                .map_err(|e| format!("Failed to flush PTY: {}", e))?;
            Ok(())
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
        PtySessionType::NativeSsh { pty_pair, .. } => {
            let pair = pty_pair.lock();
            pair.master.resize(PtySize {
                rows: params.rows as u16,
                cols: params.cols as u16,
                pixel_width: 0,
                pixel_height: 0,
            }).map_err(|e| format!("Failed to resize PTY: {}", e))?;
            Ok(())
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
            PtySessionType::NativeSsh { .. } => {
                // Native SSH PTY will be cleaned up when dropped
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

#[tauri::command]
async fn pty_keepalive(session_id: String) -> Result<String, String> {
    let pty_session_arc = {
        let sessions = PTY_SESSIONS.lock();
        sessions.get(&session_id)
            .ok_or_else(|| "Session not found".to_string())?
            .clone()
    };

    let mut pty = pty_session_arc.lock();
    match &mut pty.session_type {
        PtySessionType::Ssh { session, .. } => {
            // Temporarily set blocking for keepalive
            session.set_blocking(true);
            let result = session.keepalive_send()
                .map_err(|e| format!("Failed to send keepalive: {}", e));
            session.set_blocking(false);
            result?;
            Ok("Keepalive sent".to_string())
        },
        PtySessionType::NativeSsh { .. } => {
            Ok("Native SSH handles keepalive automatically".to_string())
        },
        PtySessionType::Local { .. } => {
            Ok("Local terminal does not need keepalive".to_string())
        }
    }
}

// SSH Key Storage

#[tauri::command]
async fn save_ssh_key_to_file(key_id: String, key_content: String) -> Result<String, String> {
    // Get the executable's directory for portable key storage
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get executable path: {}", e))?;

    let app_dir = exe_path.parent()
        .ok_or("Failed to get executable parent directory")?;

    // Create ssh_keys directory if it doesn't exist
    let keys_dir = app_dir.join("ssh_keys");
    std::fs::create_dir_all(&keys_dir)
        .map_err(|e| format!("Failed to create ssh_keys directory: {}", e))?;

    // Save key to file
    let key_file_path = keys_dir.join(format!("{}.key", key_id));

    // Check if key is in OpenSSH format and convert to PEM if needed
    let final_key_content = if key_content.contains("BEGIN OPENSSH PRIVATE KEY") {
        // Write temporary file for conversion
        let temp_key_path = keys_dir.join(format!("{}.temp", key_id));
        std::fs::write(&temp_key_path, &key_content)
            .map_err(|e| format!("Failed to write temp key file: {}", e))?;

        // Set restrictive permissions on temp file BEFORE ssh-keygen uses it
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&temp_key_path)
                .map_err(|e| format!("Failed to get temp file metadata: {}", e))?
                .permissions();
            perms.set_mode(0o600);
            std::fs::set_permissions(&temp_key_path, perms)
                .map_err(|e| format!("Failed to set temp file permissions: {}", e))?;
        }

        #[cfg(windows)]
        {
            use std::process::Command;
            let username = std::env::var("USERNAME")
                .map_err(|e| format!("Failed to get USERNAME: {}", e))?;

            let output = Command::new("icacls")
                .arg(&temp_key_path)
                .arg("/inheritance:r")
                .arg("/grant:r")
                .arg(format!("{}:(F)", username))
                .output()
                .map_err(|e| format!("Failed to execute icacls on temp file: {}", e))?;

            if !output.status.success() {
                std::fs::remove_file(&temp_key_path).ok();
                return Err(format!(
                    "Failed to set temp file permissions: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
        }

        // Convert OpenSSH format to PEM format using ssh-keygen
        let output = std::process::Command::new("ssh-keygen")
            .arg("-p")
            .arg("-f")
            .arg(&temp_key_path)
            .arg("-m")
            .arg("pem")
            .arg("-N")
            .arg("")
            .arg("-P")
            .arg("")
            .output()
            .map_err(|e| format!("Failed to run ssh-keygen for conversion: {}", e))?;

        if !output.status.success() {
            std::fs::remove_file(&temp_key_path).ok();
            return Err(format!(
                "Failed to convert key to PEM format: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        // Read the converted key
        let converted_content = std::fs::read_to_string(&temp_key_path)
            .map_err(|e| format!("Failed to read converted key: {}", e))?;

        // Clean up temp file
        std::fs::remove_file(&temp_key_path).ok();

        converted_content
    } else {
        key_content
    };

    std::fs::write(&key_file_path, final_key_content)
        .map_err(|e| format!("Failed to write key file: {}", e))?;

    // Set restrictive permissions on Unix systems
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&key_file_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o600); // rw------- (owner read/write only)
        std::fs::set_permissions(&key_file_path, perms)
            .map_err(|e| format!("Failed to set file permissions: {}", e))?;
    }

    // Set restrictive permissions on Windows
    #[cfg(windows)]
    {
        use std::process::Command;

        // Get current username
        let username = std::env::var("USERNAME")
            .map_err(|e| format!("Failed to get USERNAME: {}", e))?;

        // Use icacls to set proper permissions:
        // 1. Remove inheritance
        // 2. Remove all existing permissions
        // 3. Grant only current user Full Control
        let output = Command::new("icacls")
            .arg(&key_file_path)
            .arg("/inheritance:r")
            .arg("/grant:r")
            .arg(format!("{}:(F)", username))
            .output()
            .map_err(|e| format!("Failed to execute icacls: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "Failed to set file permissions: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }

    Ok(key_file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_ssh_key_file(key_id: String) -> Result<(), String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get executable path: {}", e))?;

    let app_dir = exe_path.parent()
        .ok_or("Failed to get executable parent directory")?;

    let key_file_path = app_dir.join("ssh_keys").join(format!("{}.key", key_id));

    if key_file_path.exists() {
        std::fs::remove_file(&key_file_path)
            .map_err(|e| format!("Failed to delete key file: {}", e))?;
    }

    Ok(())
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
            pty_keepalive,
            save_ssh_key_to_file,
            delete_ssh_key_file,
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

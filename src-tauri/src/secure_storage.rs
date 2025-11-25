use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::password_hash::{SaltString, rand_core::RngCore};
use base64::{Engine as _, engine::general_purpose};
use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::Mutex;
use once_cell::sync::Lazy;

// Global database connection
static DB_CONNECTION: Lazy<Arc<Mutex<Option<SecureDatabase>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

pub struct SecureDatabase {
    conn: Connection,
    encryption_key: Option<Vec<u8>>,
}

impl SecureDatabase {
    /// Initialize the database at the given path
    pub fn init(db_path: PathBuf) -> SqliteResult<Self> {
        let conn = Connection::open(db_path)?;

        // Create tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS credentials (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                username TEXT,
                password_encrypted TEXT,
                ssh_key_path TEXT,
                passphrase_encrypted TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        Ok(SecureDatabase {
            conn,
            encryption_key: None,
        })
    }

    /// Check if master password is set
    pub fn has_master_password(&self) -> SqliteResult<bool> {
        let result: Result<String, _> = self.conn.query_row(
            "SELECT value FROM config WHERE key = 'master_password_hash'",
            [],
            |row| row.get(0),
        );
        Ok(result.is_ok())
    }

    /// Set master password (first time setup)
    pub fn set_master_password(&mut self, password: &str) -> Result<(), String> {
        // Generate salt
        let salt = SaltString::generate(&mut OsRng);

        // Hash password with Argon2
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| format!("Failed to hash password: {}", e))?
            .to_string();

        // Store hash
        self.conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('master_password_hash', ?1)",
            [&password_hash],
        ).map_err(|e| format!("Failed to store password hash: {}", e))?;

        // Derive encryption key from password
        self.encryption_key = Some(Self::derive_key(password, salt.as_str())?);

        Ok(())
    }

    /// Unlock database with master password
    pub fn unlock(&mut self, password: &str) -> Result<(), String> {
        // Get stored hash
        let stored_hash: String = self.conn
            .query_row(
                "SELECT value FROM config WHERE key = 'master_password_hash'",
                [],
                |row| row.get(0),
            )
            .map_err(|_| "No master password set")?;

        // Verify password
        let parsed_hash = PasswordHash::new(&stored_hash)
            .map_err(|e| format!("Invalid password hash: {}", e))?;

        Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .map_err(|_| "Invalid password")?;

        // Extract salt from hash
        let salt = parsed_hash.salt
            .ok_or("No salt in password hash")?
            .as_str();

        // Derive encryption key
        self.encryption_key = Some(Self::derive_key(password, salt)?);

        Ok(())
    }

    /// Derive encryption key from password and salt
    fn derive_key(password: &str, salt: &str) -> Result<Vec<u8>, String> {
        let argon2 = Argon2::default();
        let mut key = vec![0u8; 32]; // 256-bit key for AES-256

        argon2
            .hash_password_into(password.as_bytes(), salt.as_bytes(), &mut key)
            .map_err(|e| format!("Failed to derive key: {}", e))?;

        Ok(key)
    }

    /// Encrypt data
    fn encrypt(&self, data: &str) -> Result<String, String> {
        let key = self.encryption_key.as_ref()
            .ok_or("Database not unlocked")?;

        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;

        // Generate random nonce
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encrypt
        let ciphertext = cipher
            .encrypt(nonce, data.as_bytes())
            .map_err(|e| format!("Encryption failed: {}", e))?;

        // Combine nonce + ciphertext and encode as base64
        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ciphertext);

        Ok(general_purpose::STANDARD.encode(&combined))
    }

    /// Decrypt data
    fn decrypt(&self, encrypted: &str) -> Result<String, String> {
        let key = self.encryption_key.as_ref()
            .ok_or("Database not unlocked")?;

        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;

        // Decode base64
        let combined = general_purpose::STANDARD
            .decode(encrypted)
            .map_err(|e| format!("Failed to decode base64: {}", e))?;

        if combined.len() < 12 {
            return Err("Invalid encrypted data".to_string());
        }

        // Split nonce and ciphertext
        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        // Decrypt
        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {}", e))?;

        String::from_utf8(plaintext)
            .map_err(|e| format!("Invalid UTF-8: {}", e))
    }

    /// Store encrypted credential
    pub fn store_credential(
        &self,
        id: &str,
        name: &str,
        username: Option<&str>,
        password: Option<&str>,
        ssh_key_path: Option<&str>,
        passphrase: Option<&str>,
    ) -> Result<(), String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let password_encrypted = password
            .map(|p| self.encrypt(p))
            .transpose()?;

        let passphrase_encrypted = passphrase
            .map(|p| self.encrypt(p))
            .transpose()?;

        self.conn.execute(
            "INSERT OR REPLACE INTO credentials
             (id, name, username, password_encrypted, ssh_key_path, passphrase_encrypted, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            (
                id,
                name,
                username,
                password_encrypted.as_deref(),
                ssh_key_path,
                passphrase_encrypted.as_deref(),
                now,
                now,
            ),
        ).map_err(|e| format!("Failed to store credential: {}", e))?;

        Ok(())
    }

    /// Retrieve and decrypt credential
    pub fn get_credential(&self, id: &str) -> Result<StoredCredential, String> {
        let mut stmt = self.conn.prepare(
            "SELECT name, username, password_encrypted, ssh_key_path, passphrase_encrypted
             FROM credentials WHERE id = ?1"
        ).map_err(|e| format!("Failed to prepare query: {}", e))?;

        let result = stmt.query_row([id], |row| {
            Ok(StoredCredential {
                name: row.get(0)?,
                username: row.get(1)?,
                password_encrypted: row.get(2)?,
                ssh_key_path: row.get(3)?,
                passphrase_encrypted: row.get(4)?,
            })
        }).map_err(|_| "Credential not found")?;

        Ok(result)
    }

    /// Decrypt password from stored credential
    pub fn decrypt_password(&self, encrypted: Option<String>) -> Result<Option<String>, String> {
        encrypted
            .map(|e| self.decrypt(&e))
            .transpose()
    }

    /// Delete credential
    pub fn delete_credential(&self, id: &str) -> Result<(), String> {
        self.conn.execute(
            "DELETE FROM credentials WHERE id = ?1",
            [id],
        ).map_err(|e| format!("Failed to delete credential: {}", e))?;
        Ok(())
    }

    /// Check if database is unlocked
    pub fn is_unlocked(&self) -> bool {
        self.encryption_key.is_some()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoredCredential {
    pub name: String,
    pub username: Option<String>,
    pub password_encrypted: Option<String>,
    pub ssh_key_path: Option<String>,
    pub passphrase_encrypted: Option<String>,
}

// Global database functions
pub fn init_database(db_path: PathBuf) -> Result<(), String> {
    let db = SecureDatabase::init(db_path)
        .map_err(|e| format!("Failed to initialize database: {}", e))?;
    *DB_CONNECTION.lock() = Some(db);
    Ok(())
}

pub fn with_database<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&mut SecureDatabase) -> Result<R, String>,
{
    let mut guard = DB_CONNECTION.lock();
    let db = guard.as_mut().ok_or("Database not initialized")?;
    f(db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_db() -> (TempDir, SecureDatabase) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = SecureDatabase::init(db_path).unwrap();
        (temp_dir, db)
    }

    #[test]
    fn test_database_initialization() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        
        let result = SecureDatabase::init(db_path);
        assert!(result.is_ok());
    }

    #[test]
    fn test_master_password_not_set_initially() {
        let (_temp_dir, db) = create_test_db();
        
        let has_password = db.has_master_password().unwrap();
        assert!(!has_password);
    }

    #[test]
    fn test_set_master_password() {
        let (_temp_dir, mut db) = create_test_db();
        
        let result = db.set_master_password("test_password");
        assert!(result.is_ok());
        
        let has_password = db.has_master_password().unwrap();
        assert!(has_password);
    }

    #[test]
    fn test_unlock_with_correct_password() {
        let (_temp_dir, mut db) = create_test_db();
        
        db.set_master_password("test_password").unwrap();
        
        let result = db.unlock("test_password");
        assert!(result.is_ok());
    }

    #[test]
    fn test_unlock_with_wrong_password() {
        let (_temp_dir, mut db) = create_test_db();
        
        db.set_master_password("test_password").unwrap();
        
        let result = db.unlock("wrong_password");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid password");
    }

    #[test]
    fn test_encryption_decryption() {
        let (_temp_dir, mut db) = create_test_db();
        
        db.set_master_password("test_password").unwrap();
        
        let original_text = "This is a secret message";
        let encrypted = db.encrypt(original_text).unwrap();
        
        // Encrypted text should be different from original
        assert_ne!(encrypted, original_text);
        
        // Decryption should restore original text
        let decrypted = db.decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, original_text);
    }

    #[test]
    fn test_encryption_without_unlock_fails() {
        let (_temp_dir, db) = create_test_db();
        
        let result = db.encrypt("test");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Database not unlocked");
    }

    #[test]
    fn test_decryption_without_unlock_fails() {
        let (_temp_dir, db) = create_test_db();
        
        let result = db.decrypt("fake_encrypted_data");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Database not unlocked");
    }

    #[test]
    fn test_encrypt_decrypt_multiple_messages() {
        let (_temp_dir, mut db) = create_test_db();
        
        db.set_master_password("test_password").unwrap();
        
        let messages = vec![
            "First message",
            "Second message with special chars: !@#$%^&*()",
            "Third message with numbers: 123456",
            "Unicode: 你好世界",
        ];
        
        for msg in &messages {
            let encrypted = db.encrypt(msg).unwrap();
            let decrypted = db.decrypt(&encrypted).unwrap();
            assert_eq!(decrypted, *msg);
        }
    }

    #[test]
    fn test_derive_key_deterministic() {
        let password = "test_password";
        let salt = "test_salt";
        
        let key1 = SecureDatabase::derive_key(password, salt).unwrap();
        let key2 = SecureDatabase::derive_key(password, salt).unwrap();
        
        // Same password and salt should produce same key
        assert_eq!(key1, key2);
        
        // Key should be 32 bytes (256 bits) for AES-256
        assert_eq!(key1.len(), 32);
    }

    #[test]
    fn test_different_salts_produce_different_keys() {
        let password = "test_password";

        // Use longer salts (Argon2 requires at least 8 bytes)
        let key1 = SecureDatabase::derive_key(password, "salt_string_1").unwrap();
        let key2 = SecureDatabase::derive_key(password, "salt_string_2").unwrap();

        // Different salts should produce different keys
        assert_ne!(key1, key2);
    }
}

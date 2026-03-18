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

    // ---- New tests (Phase 8) ----

    fn create_unlocked_test_db() -> (TempDir, SecureDatabase) {
        let (temp_dir, mut db) = create_test_db();
        db.set_master_password("phase8_password").unwrap();
        (temp_dir, db)
    }

    #[test]
    fn test_store_credential_succeeds_when_unlocked() {
        let (_temp_dir, db) = create_unlocked_test_db();
        let result = db.store_credential("cred-1", "My Server", Some("user1"), Some("pass1"), None, None);
        assert!(result.is_ok(), "store_credential should succeed when DB is unlocked");
    }

    #[test]
    fn test_get_credential_retrieves_stored_credential() {
        let (_temp_dir, db) = create_unlocked_test_db();
        db.store_credential("cred-2", "Test Host", Some("alice"), Some("secret"), None, None).unwrap();
        let result = db.get_credential("cred-2");
        assert!(result.is_ok(), "get_credential should return Ok for an existing id");
    }

    #[test]
    fn test_get_credential_returns_correct_fields() {
        let (_temp_dir, db) = create_unlocked_test_db();
        db.store_credential("cred-3", "prod-server", Some("bob"), Some("hunter2"), Some("/home/bob/.ssh/id_rsa"), None).unwrap();

        let stored = db.get_credential("cred-3").unwrap();
        assert_eq!(stored.name, "prod-server");
        assert_eq!(stored.username, Some("bob".to_string()));
        assert!(stored.ssh_key_path == Some("/home/bob/.ssh/id_rsa".to_string()));

        // Password is stored encrypted; decrypt_password should give back original
        let plain = db.decrypt_password(stored.password_encrypted).unwrap();
        assert_eq!(plain, Some("hunter2".to_string()));
    }

    #[test]
    fn test_store_credential_with_none_password_stores_null() {
        let (_temp_dir, db) = create_unlocked_test_db();
        db.store_credential("cred-4", "No-Pass Server", Some("charlie"), None, None, None).unwrap();

        let stored = db.get_credential("cred-4").unwrap();
        assert!(stored.password_encrypted.is_none(), "password_encrypted should be None when no password was provided");

        let decrypted = db.decrypt_password(stored.password_encrypted).unwrap();
        assert!(decrypted.is_none(), "decrypted password should be None");
    }

    #[test]
    fn test_delete_credential_removes_it() {
        let (_temp_dir, db) = create_unlocked_test_db();
        db.store_credential("cred-5", "Deletable", Some("dave"), Some("pw"), None, None).unwrap();

        // Verify it exists
        assert!(db.get_credential("cred-5").is_ok());

        // Delete it
        db.delete_credential("cred-5").unwrap();

        // Now it should not be found
        let result = db.get_credential("cred-5");
        assert!(result.is_err(), "get_credential should return Err after the credential is deleted");
    }

    #[test]
    fn test_store_credential_overwrite_updates_values() {
        let (_temp_dir, db) = create_unlocked_test_db();

        // Store initial value
        db.store_credential("cred-6", "OldName", Some("olduser"), Some("oldpass"), None, None).unwrap();

        // Overwrite with new values using same id
        db.store_credential("cred-6", "NewName", Some("newuser"), Some("newpass"), None, None).unwrap();

        let stored = db.get_credential("cred-6").unwrap();
        assert_eq!(stored.name, "NewName");
        assert_eq!(stored.username, Some("newuser".to_string()));

        let plain = db.decrypt_password(stored.password_encrypted).unwrap();
        assert_eq!(plain, Some("newpass".to_string()));
    }

    #[test]
    fn test_store_credential_fails_when_not_unlocked() {
        let (_temp_dir, db) = create_test_db();
        // DB has no encryption key — no set_master_password called
        let result = db.store_credential("cred-7", "Server", Some("user"), Some("pass"), None, None);
        assert!(result.is_err(), "store_credential should fail when DB is not unlocked");
    }

    #[test]
    fn test_is_unlocked_returns_false_before_unlock() {
        let (_temp_dir, db) = create_test_db();
        assert!(!db.is_unlocked(), "is_unlocked should be false on a freshly-initialised DB");
    }

    #[test]
    fn test_is_unlocked_returns_true_after_set_master_password() {
        let (_temp_dir, mut db) = create_test_db();
        // set_master_password also sets the encryption key (auto-unlocks)
        db.set_master_password("my_master_pw").unwrap();
        assert!(db.is_unlocked(), "is_unlocked should return true after set_master_password");
    }

    #[test]
    fn test_encrypt_same_plaintext_produces_different_ciphertext() {
        let (_temp_dir, mut db) = create_test_db();
        db.set_master_password("nonce_test_pw").unwrap();

        let plaintext = "identical plaintext for nonce test";
        let c1 = db.encrypt(plaintext).unwrap();
        let c2 = db.encrypt(plaintext).unwrap();

        // Two encryptions of the same data must differ due to random nonce
        assert_ne!(c1, c2, "Two encryptions of the same plaintext should produce different ciphertexts (random nonce)");

        // Both should still decrypt to the original plaintext
        assert_eq!(db.decrypt(&c1).unwrap(), plaintext);
        assert_eq!(db.decrypt(&c2).unwrap(), plaintext);
    }

    #[test]
    fn test_set_master_password_then_unlock_with_correct_password() {
        let (_temp_dir, mut db) = create_test_db();
        db.set_master_password("correct_horse").unwrap();

        // Simulate a fresh load: create another DB instance on the same file by
        // re-using the same connection — we reset the key to simulate a locked state.
        // The simplest way: open a new DB on the same path and unlock it.
        // We test the unlock() method directly on the same instance after clearing the key.
        // Reset encryption key to simulate locked state
        db.encryption_key = None;
        assert!(!db.is_unlocked());

        let result = db.unlock("correct_horse");
        assert!(result.is_ok(), "unlock with the correct password should succeed");
        assert!(db.is_unlocked(), "DB should be unlocked after successful unlock()");
    }

    #[test]
    fn test_unlock_with_wrong_password_returns_err() {
        let (_temp_dir, mut db) = create_test_db();
        db.set_master_password("right_password").unwrap();

        // Reset encryption key
        db.encryption_key = None;

        let result = db.unlock("wrong_password");
        assert!(result.is_err(), "unlock with wrong password should return Err");
        assert!(!db.is_unlocked(), "DB should remain locked after failed unlock attempt");
    }
}

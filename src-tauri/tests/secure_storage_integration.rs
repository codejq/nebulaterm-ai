/// Integration tests for SecureDatabase public API.
///
/// These tests treat SecureDatabase as a black box and exercise the public
/// interface end-to-end.  No Tauri context is required.
///
/// Note: because this crate is a binary-only crate (no lib.rs) the integration
/// test file includes the module directly via `#[path]`.

#[path = "../src/secure_storage.rs"]
mod secure_storage;

use secure_storage::SecureDatabase;
use tempfile::TempDir;

fn fresh_db() -> (TempDir, SecureDatabase) {
    let dir = TempDir::new().expect("failed to create temp dir");
    let path = dir.path().join("integration_test.db");
    let db = SecureDatabase::init(path).expect("DB init failed");
    (dir, db)
}

// 1. After init, has_master_password returns false
#[test]
fn test_init_has_no_master_password() {
    let (_dir, db) = fresh_db();
    assert!(!db.has_master_password().unwrap());
}

// 2. set_master_password records the hash; has_master_password returns true and is_unlocked is true
//    (set_master_password derives the key as a side-effect — this is the expected behaviour)
#[test]
fn test_set_master_password_records_hash_and_unlocks() {
    let (_dir, mut db) = fresh_db();
    assert!(!db.has_master_password().unwrap());
    db.set_master_password("integration_pw").unwrap();
    assert!(db.has_master_password().unwrap());
    // set_master_password also derives the encryption key, so is_unlocked becomes true
    assert!(db.is_unlocked());
}

// 3. set_master_password on DB-A, then open DB-B on the same file and unlock
//    with the correct password → is_unlocked returns true
#[test]
fn test_unlock_with_correct_password_succeeds() {
    let dir = TempDir::new().expect("failed to create temp dir");
    let path = dir.path().join("unlock_test.db");

    // Set up master password on first instance
    {
        let mut db = SecureDatabase::init(path.clone()).expect("init failed");
        db.set_master_password("open_sesame").unwrap();
    }

    // Open a second instance (simulates app restart — key is not in memory)
    let mut db2 = SecureDatabase::init(path).expect("re-init failed");
    assert!(!db2.is_unlocked(), "fresh instance should start locked");

    db2.unlock("open_sesame").expect("unlock should succeed");
    assert!(db2.is_unlocked());
}

// 4. unlock with wrong password returns error; DB stays locked
#[test]
fn test_unlock_with_wrong_password_is_error() {
    let dir = TempDir::new().expect("failed to create temp dir");
    let path = dir.path().join("wrong_pw_test.db");

    {
        let mut db = SecureDatabase::init(path.clone()).expect("init failed");
        db.set_master_password("correct_pw").unwrap();
    }

    let mut db2 = SecureDatabase::init(path).expect("re-init failed");
    let result = db2.unlock("incorrect_pw");
    assert!(result.is_err());
    assert!(!db2.is_unlocked());
}

// 5. store_credential → get_credential round-trip when unlocked
#[test]
fn test_store_and_get_credential_round_trip() {
    let (_dir, mut db) = fresh_db();
    db.set_master_password("roundtrip_pw").unwrap();

    db.store_credential(
        "int-cred-1",
        "Integration Server",
        Some("intuser"),
        Some("intpass"),
        None,
        None,
    )
    .expect("store_credential failed");

    let stored = db.get_credential("int-cred-1").expect("get_credential failed");
    assert_eq!(stored.name, "Integration Server");
    assert_eq!(stored.username, Some("intuser".to_string()));

    let plaintext = db
        .decrypt_password(stored.password_encrypted)
        .expect("decrypt_password failed");
    assert_eq!(plaintext, Some("intpass".to_string()));
}

use std::fs::{self, File};
use std::io::{ErrorKind, Read, Write};
use std::path::Path;

const FILE_NAME: &str = "settings.json";
const MAX_BYTES: u64 = 16 * 1024;

pub fn read(dir: &Path) -> Result<Option<String>, String> {
    let file = match File::open(dir.join(FILE_NAME)) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut json = String::new();
    file.take(MAX_BYTES + 1)
        .read_to_string(&mut json)
        .map_err(|error| error.to_string())?;
    if json.len() as u64 > MAX_BYTES {
        return Err("設定ファイルが大きすぎます。".into());
    }
    Ok(Some(json))
}

pub fn write(dir: &Path, json: &str) -> Result<(), String> {
    if json.len() as u64 > MAX_BYTES {
        return Err("設定ファイルが大きすぎます。".into());
    }
    let value: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    if !value.is_object() {
        return Err("設定JSONが無効です。".into());
    }
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(dir).map_err(|error| error.to_string())?;
    temporary
        .write_all(json.as_bytes())
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    // Replace only after the complete new file has been written successfully.
    temporary
        .persist(dir.join(FILE_NAME))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_and_atomic_replacement() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("config");
        assert_eq!(read(&dir).unwrap(), None);
        let first = r#"{"version":1,"values":{"fps":"30"}}"#;
        let second = r#"{"version":1,"values":{"fps":"60"}}"#;
        write(&dir, first).unwrap();
        assert_eq!(read(&dir).unwrap().as_deref(), Some(first));
        write(&dir, second).unwrap();
        assert_eq!(read(&dir).unwrap().as_deref(), Some(second));
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn invalid_write_keeps_previous_file() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path();
        let valid = r#"{"version":1,"values":{}}"#;
        write(dir, valid).unwrap();
        assert!(write(dir, "{").is_err());
        assert!(write(dir, "[]").is_err());
        assert!(write(dir, &" ".repeat(MAX_BYTES as usize + 1)).is_err());
        assert_eq!(read(dir).unwrap().as_deref(), Some(valid));
    }

    #[test]
    fn rejects_oversized_or_non_utf8_file() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join(FILE_NAME);
        fs::write(&path, vec![b'a'; MAX_BYTES as usize + 1]).unwrap();
        assert!(read(root.path()).is_err());
        fs::write(&path, [0xff]).unwrap();
        assert!(read(root.path()).is_err());
    }
}

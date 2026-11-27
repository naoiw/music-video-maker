use crate::errors;
use std::fs::{self, File};
use std::io::{ErrorKind, Read, Write};
use std::path::Path;

const FILE_NAME: &str = "settings.json";
const MAX_BYTES: u64 = 16 * 1024;
const PRESET_FILE_NAME: &str = "presets.json";
const PRESET_MAX_BYTES: u64 = 64 * 1024;

pub fn read(dir: &Path) -> Result<Option<String>, String> {
    read_json(dir, FILE_NAME, MAX_BYTES)
}

pub fn read_presets(dir: &Path) -> Result<Option<String>, String> {
    read_json(dir, PRESET_FILE_NAME, PRESET_MAX_BYTES)
}

fn read_json(dir: &Path, file_name: &str, max_bytes: u64) -> Result<Option<String>, String> {
    let file = match File::open(dir.join(file_name)) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(errors::io_error(
                "設定ファイルを開けません",
                &error,
                "SETTINGS_IO",
            ));
        }
    };
    let mut json = String::new();
    file.take(max_bytes + 1)
        .read_to_string(&mut json)
        .map_err(|error| errors::io_error("設定ファイルの読み込み", &error, "SETTINGS_IO"))?;
    if json.len() as u64 > max_bytes {
        return Err("設定ファイルが大きすぎます。".into());
    }
    Ok(Some(json))
}

pub fn write(dir: &Path, json: &str) -> Result<(), String> {
    write_json(dir, FILE_NAME, MAX_BYTES, json)
}

pub fn write_presets(dir: &Path, json: &str) -> Result<(), String> {
    write_json(dir, PRESET_FILE_NAME, PRESET_MAX_BYTES, json)
}

fn write_json(dir: &Path, file_name: &str, max_bytes: u64, json: &str) -> Result<(), String> {
    if json.len() as u64 > max_bytes {
        return Err("設定ファイルが大きすぎます。".into());
    }
    let value: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    if !value.is_object() {
        return Err("設定JSONが無効です。".into());
    }
    fs::create_dir_all(dir)
        .map_err(|error| errors::io_error("設定フォルダの作成", &error, "SETTINGS_IO"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(dir)
        .map_err(|error| errors::io_error("設定用一時ファイル", &error, "SETTINGS_IO"))?;
    temporary
        .write_all(json.as_bytes())
        .map_err(|error| errors::io_error("設定ファイルの書き込み", &error, "SETTINGS_IO"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| errors::io_error("設定ファイルの同期", &error, "SETTINGS_IO"))?;
    // Replace only after the complete new file has been written successfully.
    temporary
        .persist(dir.join(file_name))
        .map_err(|error| errors::io_error("設定ファイルの置換", &error.error, "SETTINGS_IO"))?;
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
    fn presets_are_independent_and_invalid_writes_preserve_them() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path();
        let settings_json = r#"{"version":1,"values":{}}"#;
        let presets_json = r#"{"version":1,"presets":[]}"#;
        let updated = r#"{"version":1,"presets":[{"name":"Test"}]}"#;
        write(dir, settings_json).unwrap();
        assert_eq!(read_presets(dir).unwrap(), None);
        write_presets(dir, presets_json).unwrap();
        write_presets(dir, updated).unwrap();
        assert!(write_presets(dir, "{").is_err());
        assert!(write_presets(dir, &" ".repeat(PRESET_MAX_BYTES as usize + 1)).is_err());
        assert_eq!(read_presets(dir).unwrap().as_deref(), Some(updated));
        assert_eq!(read(dir).unwrap().as_deref(), Some(settings_json));
        fs::write(
            dir.join(PRESET_FILE_NAME),
            vec![b'a'; PRESET_MAX_BYTES as usize + 1],
        )
        .unwrap();
        assert!(read_presets(dir).is_err());
        assert_eq!(read(dir).unwrap().as_deref(), Some(settings_json));
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

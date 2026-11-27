use crate::errors;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{ImageFormat, ImageReader};
use serde::Serialize;
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::Path;

const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VisualInfo {
    name: String,
    pub(crate) format: &'static str,
    mime_type: &'static str,
    width: u32,
    height: u32,
    size_bytes: usize,
    preview_base64: String,
}

fn expected_format(path: &Path) -> Result<ImageFormat, String> {
    if !path.is_absolute() {
        return Err("ローカルの画像ファイルを選択してください。".into());
    }
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => Ok(ImageFormat::Png),
        Some("jpg" | "jpeg") => Ok(ImageFormat::Jpeg),
        Some("gif") => Ok(ImageFormat::Gif),
        _ => Err("PNG・JPEG・GIF の画像を選択してください。".into()),
    }
}

fn dimensions_are_supported(width: u32, height: u32) -> bool {
    width > 0 && height > 0 && u64::from(width) * u64::from(height) <= MAX_IMAGE_PIXELS
}

fn inspect_image(name: String, expected: ImageFormat, bytes: &[u8]) -> Result<VisualInfo, String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("画像が空、または 32 MiB を超えています。".into());
    }

    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| format!("画像形式を確認できません: {error}"))?;
    if reader.format() != Some(expected) {
        return Err("拡張子と画像の実際の形式が一致しません。".into());
    }
    let (format, mime_type) = match expected {
        ImageFormat::Png => ("PNG", "image/png"),
        ImageFormat::Jpeg => ("JPEG", "image/jpeg"),
        ImageFormat::Gif => ("GIF", "image/gif"),
        _ => return Err("非対応の画像形式です。".into()),
    };

    let (width, height) = reader
        .into_dimensions()
        .map_err(|error| format!("画像の寸法を取得できません: {error}"))?;
    if !dimensions_are_supported(width, height) {
        return Err("画像の寸法が無効、または 4000 万画素を超えています。".into());
    }

    Ok(VisualInfo {
        name,
        format,
        mime_type,
        width,
        height,
        size_bytes: bytes.len(),
        preview_base64: STANDARD.encode(bytes),
    })
}

pub(crate) fn load_visual(path: &str) -> Result<VisualInfo, String> {
    load_visual_inner(path).map_err(|error| errors::tagged("INPUT_IMAGE", error))
}

fn load_visual_inner(path: &str) -> Result<VisualInfo, String> {
    let path = Path::new(path);
    let format = expected_format(path)?;
    let metadata = path
        .metadata()
        .map_err(|error| errors::io_error("画像ファイルを開けません", &error, "INPUT_IMAGE"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err("通常の画像ファイル（32 MiB 以下）を選択してください。".into());
    }
    let file = File::open(path)
        .map_err(|error| errors::io_error("画像を開けません", &error, "INPUT_IMAGE"))?;
    let mut bytes = Vec::new();
    file.take((MAX_IMAGE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| errors::io_error("画像を読み込めません", &error, "INPUT_IMAGE"))?;
    let name = path
        .file_name()
        .ok_or_else(|| "ファイル名を取得できません。".to_owned())?
        .to_string_lossy()
        .into_owned();

    inspect_image(name, format, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(format: ImageFormat) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(12, 8)
            .write_to(&mut output, format)
            .unwrap();
        output.into_inner()
    }

    #[test]
    fn reads_supported_image_formats() {
        for (format, label, mime) in [
            (ImageFormat::Png, "PNG", "image/png"),
            (ImageFormat::Jpeg, "JPEG", "image/jpeg"),
            (ImageFormat::Gif, "GIF", "image/gif"),
        ] {
            let bytes = fixture(format);
            let info = inspect_image("sample".into(), format, &bytes).unwrap();
            assert_eq!(info.name, "sample");
            assert_eq!(info.format, label);
            assert_eq!(info.mime_type, mime);
            assert_eq!((info.width, info.height), (12, 8));
            assert_eq!(info.size_bytes, bytes.len());
            assert_eq!(STANDARD.decode(info.preview_base64).unwrap(), bytes);
        }
    }

    #[test]
    fn rejects_wrong_format_and_invalid_data() {
        let png = fixture(ImageFormat::Png);
        assert!(inspect_image("wrong.jpg".into(), ImageFormat::Jpeg, &png).is_err());
        assert!(inspect_image("empty.png".into(), ImageFormat::Png, &[]).is_err());
        assert!(inspect_image("broken.gif".into(), ImageFormat::Gif, b"GIF89a").is_err());
        assert!(inspect_image("text.png".into(), ImageFormat::Png, b"hello").is_err());
    }

    #[test]
    fn restricts_paths_and_dimensions() {
        let dir = std::env::temp_dir();
        assert_eq!(
            expected_format(&dir.join("cover.JPEG")).unwrap(),
            ImageFormat::Jpeg
        );
        assert!(expected_format(&dir.join("cover.svg")).is_err());
        assert!(expected_format(Path::new("relative.png")).is_err());
        assert!(dimensions_are_supported(1920, 1080));
        assert!(!dimensions_are_supported(0, 100));
        assert!(!dimensions_are_supported(100_000, 100_000));
    }

    #[test]
    fn loads_local_images_and_rejects_invalid_file_paths() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("画像.JPEG");
        let bytes = fixture(ImageFormat::Jpeg);
        std::fs::write(&path, &bytes).unwrap();
        let info = load_visual(path.to_str().unwrap()).unwrap();
        assert_eq!(info.name, "画像.JPEG");
        assert_eq!((info.width, info.height), (12, 8));
        assert_eq!(STANDARD.decode(info.preview_base64).unwrap(), bytes);

        let empty = dir.path().join("empty.png");
        let oversized = dir.path().join("oversized.png");
        let missing = dir.path().join("missing.png");
        std::fs::write(&empty, []).unwrap();
        File::create(&oversized)
            .unwrap()
            .set_len(MAX_IMAGE_BYTES as u64 + 1)
            .unwrap();
        for (path, code) in [
            (empty, "[MVM:INPUT_IMAGE]"),
            (oversized, "[MVM:INPUT_IMAGE]"),
            (missing, "[MVM:PATH_MISSING]"),
        ] {
            assert!(load_visual(path.to_str().unwrap())
                .unwrap_err()
                .starts_with(code));
        }
    }
}

//! Validate the destination and verify the encoded MP4 before publishing it.

use super::OutputSettings;
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
struct ProbeResult {
    streams: Vec<Stream>,
    format: OutputFormat,
}

#[derive(Deserialize)]
struct Stream {
    codec_name: String,
    codec_type: String,
    width: Option<u32>,
    height: Option<u32>,
    pix_fmt: Option<String>,
    r_frame_rate: Option<String>,
    duration: Option<String>,
}

#[derive(Deserialize)]
struct OutputFormat {
    duration: String,
}

pub(super) fn positive_duration(value: &str) -> Result<f64, String> {
    value
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| "生成動画の再生時間を確認できません。".to_owned())
}

pub(super) fn validate_output(bytes: &[u8], settings: OutputSettings) -> Result<f64, String> {
    let result: ProbeResult =
        serde_json::from_slice(bytes).map_err(|error| format!("FFprobe JSON: {error}"))?;
    let video = result
        .streams
        .iter()
        .find(|stream| stream.codec_type == "video")
        .ok_or_else(|| "生成動画に映像がありません。".to_owned())?;
    let audio = result
        .streams
        .iter()
        .find(|stream| stream.codec_type == "audio")
        .ok_or_else(|| "生成動画に音声がありません。".to_owned())?;
    let expected_fps = format!("{}/1", settings.fps);
    if result.streams.len() != 2
        || video.codec_name != "h264"
        || audio.codec_name != "aac"
        || video.width != Some(settings.width)
        || video.height != Some(settings.height)
        || video.pix_fmt.as_deref() != Some("yuv420p")
        || video.r_frame_rate.as_deref() != Some(expected_fps.as_str())
    {
        return Err("生成動画の形式が出力設定と一致しません。".into());
    }
    let video_duration = positive_duration(video.duration.as_deref().unwrap_or_default())?;
    let audio_duration = positive_duration(audio.duration.as_deref().unwrap_or_default())?;
    if (video_duration - audio_duration).abs() > 0.2 {
        return Err(format!(
            "生成動画の映像と音声の長さが一致しません（映像 {video_duration:.3} 秒、音声 {audio_duration:.3} 秒）。"
        ));
    }
    positive_duration(&result.format.duration)
}

pub(super) fn validate_destination(path: &Path) -> Result<&Path, String> {
    if !path.is_absolute()
        || !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("mp4"))
    {
        return Err(crate::errors::tagged(
            "OUTPUT_PATH",
            "MP4 の保存先を指定してください。",
        ));
    }
    match path.symlink_metadata() {
        Ok(_) => {
            return Err(crate::errors::tagged(
                "OUTPUT_EXISTS",
                "既存ファイルは上書きできません。別の名前を指定してください。",
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(crate::errors::io_error(
                "保存先を確認できません",
                &error,
                "OUTPUT_IO",
            ));
        }
    }
    let parent = path
        .parent()
        .ok_or_else(|| crate::errors::tagged("OUTPUT_PATH", "保存先のフォルダがありません。"))?;
    let metadata = parent.metadata().map_err(|error| {
        crate::errors::io_error("保存先のフォルダを確認できません", &error, "OUTPUT_IO")
    })?;
    if !metadata.is_dir() {
        return Err(crate::errors::tagged(
            "OUTPUT_PATH",
            "保存先がフォルダではありません。",
        ));
    }
    Ok(parent)
}

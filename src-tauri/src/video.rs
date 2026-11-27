use crate::{audio, ffmpeg::Tool, visual};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

static ENCODE_LOCK: Mutex<()> = Mutex::new(());

const VIDEO_FILTER: &str = concat!(
    "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,",
    "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoInfo {
    duration_seconds: f64,
    size_bytes: u64,
}

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

fn encoder_args<'a>(
    audio_path: &'a str,
    visual_path: &'a str,
    image_codec: &'a str,
    temporary_path: &'a str,
) -> Vec<&'a str> {
    vec![
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-xerror",
        "-y", // Only the private temporary file can be overwritten.
        "-protocol_whitelist",
        "file",
        "-f",
        "image2",
        "-pattern_type",
        "none",
        "-loop",
        "1",
        "-framerate",
        "30",
        "-c:v",
        image_codec,
        "-i",
        visual_path,
        "-protocol_whitelist",
        "file",
        "-f",
        "mp3",
        "-i",
        audio_path,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-map_metadata",
        "-1",
        "-vf",
        VIDEO_FILTER,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-shortest",
        "-f",
        "mp4",
        temporary_path,
    ]
}

fn positive_duration(value: &str) -> Result<f64, String> {
    value
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| "生成動画の再生時間を確認できません。".to_owned())
}

fn validate_output(bytes: &[u8]) -> Result<f64, String> {
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
    if result.streams.len() != 2
        || video.codec_name != "h264"
        || audio.codec_name != "aac"
        || video.width != Some(1920)
        || video.height != Some(1080)
        || video.pix_fmt.as_deref() != Some("yuv420p")
        || video.r_frame_rate.as_deref() != Some("30/1")
    {
        return Err("生成動画の形式が出力設定と一致しません。".into());
    }
    let video_duration = positive_duration(video.duration.as_deref().unwrap_or_default())?;
    let audio_duration = positive_duration(audio.duration.as_deref().unwrap_or_default())?;
    if (video_duration - audio_duration).abs() > 0.2 {
        return Err("生成動画の映像と音声の長さが一致しません。".into());
    }
    positive_duration(&result.format.duration)
}

fn validate_destination(path: &Path) -> Result<&Path, String> {
    if !path.is_absolute()
        || !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("mp4"))
    {
        return Err("MP4 の保存先を指定してください。".into());
    }
    match path.symlink_metadata() {
        Ok(_) => return Err("既存ファイルは上書きできません。別の名前を指定してください。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("保存先を確認できません: {error}")),
    }
    path.parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| "保存先のフォルダがありません。".to_owned())
}

pub(crate) fn encode_static_video(
    audio_path: &str,
    visual_path: &str,
    output_path: &str,
) -> Result<VideoInfo, String> {
    let _guard = ENCODE_LOCK
        .try_lock()
        .map_err(|_| "別の動画生成を実行中です。".to_owned())?;
    let destination = Path::new(output_path);
    let parent = validate_destination(destination)?;

    // Revalidate sources at export time; do not trust GUI metadata.
    audio::probe_audio(audio_path)?;
    let image = visual::load_visual(visual_path)?;
    let codec = match image.format {
        "PNG" => "png",
        "JPEG" => "mjpeg",
        _ => return Err("GIF の動画合成にはまだ対応していません。".into()),
    };
    drop(image);

    // Stage on the same filesystem; publish only after successful verification.
    let temporary = tempfile::Builder::new()
        .prefix(".music-video-maker-")
        .suffix(".mp4")
        .tempfile_in(parent)
        .map_err(|error| format!("一時ファイルを作成できません: {error}"))?
        .into_temp_path();
    let temp_path = temporary
        .to_str()
        .ok_or_else(|| "一時ファイルのパスを処理できません。".to_owned())?;

    Tool::Ffmpeg.run(&encoder_args(audio_path, visual_path, codec, temp_path))?;

    let probe = Tool::Ffprobe.run(&[
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-show_entries",
        "stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate,duration:format=duration",
        "-of",
        "json",
        "-i",
        temp_path,
    ])?;
    let duration_seconds = validate_output(&probe.stdout)?;
    let size_bytes = std::fs::metadata(temp_path)
        .map_err(|error| format!("出力ファイルを確認できません: {error}"))?
        .len();
    temporary
        .persist_noclobber(destination)
        .map_err(|error| format!("動画を保存できません: {error}"))?;

    Ok(VideoInfo {
        duration_seconds,
        size_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_keep_paths_separate_and_map_only_requested_streams() {
        let args = encoder_args("music file.mp3", "cover %d.png", "png", "temp.mp4");
        assert!(args.windows(2).any(|pair| pair == ["-i", "cover %d.png"]));
        assert!(args.windows(2).any(|pair| pair == ["-i", "music file.mp3"]));
        assert!(args.windows(2).any(|pair| pair == ["-pattern_type", "none"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "1:a:0"]));
        assert!(args.contains(&"-shortest"));
        assert_eq!(args.last(), Some(&"temp.mp4"));
    }

    #[test]
    fn refuses_existing_or_invalid_destination() {
        let dir = tempfile::tempdir().unwrap();
        let existing = dir.path().join("existing.mp4");
        std::fs::write(&existing, b"keep").unwrap();
        assert!(validate_destination(&existing).is_err());
        assert_eq!(std::fs::read(&existing).unwrap(), b"keep");
        assert!(validate_destination(Path::new("relative.mp4")).is_err());
        assert!(validate_destination(&dir.path().join("wrong.wav")).is_err());
        assert!(validate_destination(&dir.path().join("new.mp4")).is_ok());
    }

    #[test]
    fn rejects_unverified_output() {
        assert!(validate_output(b"{}").is_err());
        assert!(validate_output(br#"{"streams":[],"format":{"duration":"2"}}"#).is_err());
        assert!(positive_duration("NaN").is_err());
        assert!(positive_duration("0").is_err());
    }

    #[test]
    #[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
    fn encodes_png_and_jpeg() {
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("music test.mp3");
        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2.3",
                "-c:a",
                "libmp3lame",
                audio.to_str().unwrap(),
            ])
            .unwrap();
        for extension in ["png", "jpg"] {
            let cover = dir.path().join(format!("cover %d.{extension}"));
            let output = dir.path().join(format!("result {extension}.mp4"));
            image::DynamicImage::new_rgb8(513, 777)
                .save(&cover)
                .unwrap();
            let info = encode_static_video(
                audio.to_str().unwrap(),
                cover.to_str().unwrap(),
                output.to_str().unwrap(),
            )
            .unwrap();
            assert!((info.duration_seconds - 2.3).abs() < 0.2);
            assert!(info.size_bytes > 0);
            assert!(output.is_file());
            assert!(encode_static_video(
                audio.to_str().unwrap(),
                cover.to_str().unwrap(),
                output.to_str().unwrap(),
            )
            .is_err());
        }
    }
}

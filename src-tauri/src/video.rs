use crate::{audio, ffmpeg::Tool, visual};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

static ENCODE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ImageFit {
    Contain,
    Cover,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub(crate) struct OutputSettings {
    width: u32,
    height: u32,
    fps: u32,
    crf: u32,
    fit: ImageFit,
}

impl Default for OutputSettings {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            fps: 30,
            crf: 20,
            fit: ImageFit::Contain,
        }
    }
}

impl OutputSettings {
    fn validate(self) -> Result<(), String> {
        if !matches!(
            (self.width, self.height),
            (1920, 1080) | (1080, 1080) | (1080, 1920)
        ) {
            return Err("非対応の出力解像度です。".into());
        }
        if !matches!(self.fps, 24 | 30 | 60) || !matches!(self.crf, 16 | 20 | 24) {
            return Err("非対応の FPS または画質設定です。".into());
        }
        Ok(())
    }

    fn filter(self) -> String {
        let (width, height) = (self.width, self.height);
        let (mode, placement) = match self.fit {
            ImageFit::Contain => (
                "decrease",
                format!("pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"),
            ),
            ImageFit::Cover => (
                "increase",
                format!("crop={width}:{height}:(iw-ow)/2:(ih-oh)/2"),
            ),
        };
        format!(
            "scale={width}:{height}:force_original_aspect_ratio={mode}:force_divisible_by=2:out_range=tv,{placement},setsar=1"
        )
    }
}

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

#[derive(Clone, Copy)]
enum VisualKind {
    Png,
    Jpeg,
    Gif,
}

fn encoder_args(
    audio_path: &str,
    visual_path: &str,
    source: VisualKind,
    temporary_path: &str,
    settings: OutputSettings,
) -> Vec<String> {
    let fps = settings.fps.to_string();
    let crf = settings.crf.to_string();
    let filter = settings.filter();
    let mut args = vec![
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-xerror",
        "-y", // Only the private temporary file can be overwritten.
        "-protocol_whitelist",
        "file",
    ];
    match source {
        VisualKind::Gif => args.extend(["-f", "gif", "-ignore_loop", "1", "-stream_loop", "-1"]),
        VisualKind::Png | VisualKind::Jpeg => {
            let codec = match source {
                VisualKind::Png => "png",
                _ => "mjpeg",
            };
            args.extend([
                "-f",
                "image2",
                "-pattern_type",
                "none",
                "-loop",
                "1",
                "-framerate",
                &fps,
                "-c:v",
                codec,
            ]);
        }
    }
    args.extend([
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
        &filter,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        &crf,
        "-pix_fmt",
        "yuv420p",
        "-color_range",
        "tv",
        "-r",
        &fps,
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
    ]);
    args.into_iter().map(str::to_owned).collect()
}

fn positive_duration(value: &str) -> Result<f64, String> {
    value
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| "生成動画の再生時間を確認できません。".to_owned())
}

fn validate_output(bytes: &[u8], settings: OutputSettings) -> Result<f64, String> {
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

pub(crate) fn encode_video(
    audio_path: &str,
    visual_path: &str,
    output_path: &str,
    settings: OutputSettings,
) -> Result<VideoInfo, String> {
    settings.validate()?;
    let _guard = ENCODE_LOCK
        .try_lock()
        .map_err(|_| "別の動画生成を実行中です。".to_owned())?;
    let destination = Path::new(output_path);
    let parent = validate_destination(destination)?;

    // Revalidate sources at export time; do not trust GUI metadata.
    audio::probe_audio(audio_path)?;
    let image = visual::load_visual(visual_path)?;
    let source = match image.format {
        "PNG" => VisualKind::Png,
        "JPEG" => VisualKind::Jpeg,
        "GIF" => VisualKind::Gif,
        _ => return Err("非対応の画像形式です。".into()),
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

    let args = encoder_args(audio_path, visual_path, source, temp_path, settings);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    Tool::Ffmpeg.run(&args)?;

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
    let duration_seconds = validate_output(&probe.stdout, settings)?;
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
        let args = encoder_args(
            "music file.mp3",
            "cover %d.png",
            VisualKind::Png,
            "temp.mp4",
            OutputSettings::default(),
        );
        assert!(args.windows(2).any(|pair| pair == ["-i", "cover %d.png"]));
        assert!(args.windows(2).any(|pair| pair == ["-i", "music file.mp3"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-pattern_type", "none"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "1:a:0"]));
        assert!(args.iter().any(|arg| arg == "-shortest"));
        assert_eq!(args.last().map(String::as_str), Some("temp.mp4"));
    }

    #[test]
    fn gif_arguments_ignore_embedded_loop_count() {
        let args = encoder_args(
            "audio.mp3",
            "cover.gif",
            VisualKind::Gif,
            "temp.mp4",
            OutputSettings::default(),
        );
        assert!(args.windows(2).any(|pair| pair == ["-f", "gif"]));
        assert!(args.windows(2).any(|pair| pair == ["-ignore_loop", "1"]));
        assert!(args.windows(2).any(|pair| pair == ["-stream_loop", "-1"]));
        assert!(!args.iter().any(|arg| arg == "-pattern_type"));
        assert!(args.iter().any(|arg| arg == "-shortest"));
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
        assert!(validate_output(b"{}", OutputSettings::default()).is_err());
        assert!(validate_output(
            br#"{"streams":[],"format":{"duration":"2"}}"#,
            OutputSettings::default(),
        )
        .is_err());
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
            let info = encode_video(
                audio.to_str().unwrap(),
                cover.to_str().unwrap(),
                output.to_str().unwrap(),
                OutputSettings::default(),
            )
            .unwrap();
            assert!((info.duration_seconds - 2.3).abs() < 0.2);
            assert!(info.size_bytes > 0);
            assert!(output.is_file());
            assert!(encode_video(
                audio.to_str().unwrap(),
                cover.to_str().unwrap(),
                output.to_str().unwrap(),
                OutputSettings::default(),
            )
            .is_err());
        }
    }

    fn sample_color(path: &Path, timestamp: &str) -> Vec<u8> {
        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-ss",
                timestamp,
                "-i",
                path.to_str().unwrap(),
                "-frames:v",
                "1",
                "-vf",
                "crop=2:2:960:540,format=rgb24",
                "-f",
                "rawvideo",
                "-",
            ])
            .unwrap()
            .stdout
    }

    #[test]
    #[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
    fn encodes_gif_with_repeated_animation() {
        use image::codecs::gif::{GifEncoder, Repeat};
        use image::{Delay, Frame, Rgba, RgbaImage};

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

        for (name, repeat) in [
            ("no-loop", None),
            ("finite-loop", Some(Repeat::Finite(1))),
            ("infinite-loop", Some(Repeat::Infinite)),
        ] {
            let cover = dir.path().join(format!("{name}.gif"));
            let output = dir.path().join(format!("{name}.mp4"));
            {
                let mut encoder = GifEncoder::new(std::fs::File::create(&cover).unwrap());
                if let Some(repeat) = repeat {
                    encoder.set_repeat(repeat).unwrap();
                }
                for (color, delay) in [([255, 0, 0, 255], 200), ([0, 0, 255, 255], 300)] {
                    encoder
                        .encode_frame(Frame::from_parts(
                            RgbaImage::from_pixel(64, 48, Rgba(color)),
                            0,
                            0,
                            Delay::from_numer_denom_ms(delay, 1),
                        ))
                        .unwrap();
                }
            }

            let info = encode_video(
                audio.to_str().unwrap(),
                cover.to_str().unwrap(),
                output.to_str().unwrap(),
                OutputSettings::default(),
            )
            .unwrap();
            assert!((info.duration_seconds - 2.3).abs() < 0.2);
            assert!(info.size_bytes > 0);

            // Check decoded colors during the first cycle and well after the original GIF ends.
            for (timestamp, red) in [
                ("0.1", true),
                ("0.35", false),
                ("1.6", true),
                ("1.85", false),
                ("2.1", true),
            ] {
                let pixel = sample_color(&output, timestamp);
                assert_eq!(pixel.len(), 12);
                if red {
                    assert!(pixel[0] > 200 && pixel[2] < 50, "{name}: {timestamp}");
                } else {
                    assert!(pixel[2] > 200 && pixel[0] < 50, "{name}: {timestamp}");
                }
            }
        }
    }

    #[test]
    fn validates_settings_and_generates_fit_filters() {
        let defaults = OutputSettings::default();
        assert!(defaults.validate().is_ok());
        assert!(defaults.filter().contains("pad=1920:1080"));
        let cover = OutputSettings {
            width: 1080,
            height: 1920,
            fps: 60,
            crf: 16,
            fit: ImageFit::Cover,
        };
        assert!(cover.validate().is_ok());
        assert!(cover.filter().contains("crop=1080:1920"));
        let args = encoder_args("a.mp3", "b.png", VisualKind::Png, "c.mp4", cover);
        assert!(args.windows(2).any(|pair| pair == ["-framerate", "60"]));
        assert!(args.windows(2).any(|pair| pair == ["-r", "60"]));
        assert!(args.windows(2).any(|pair| pair == ["-crf", "16"]));
        for settings in [
            OutputSettings {
                width: 1,
                ..defaults
            },
            OutputSettings { fps: 0, ..defaults },
            OutputSettings {
                crf: 99,
                ..defaults
            },
        ] {
            assert!(settings.validate().is_err());
        }
    }

    #[test]
    #[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
    fn encodes_custom_output_settings() {
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("song.mp3");
        let cover = dir.path().join("square.png");
        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1.2",
                "-c:a",
                "libmp3lame",
                audio.to_str().unwrap(),
            ])
            .unwrap();
        image::DynamicImage::new_rgb8(640, 640)
            .save(&cover)
            .unwrap();
        for (name, settings) in [
            (
                "square",
                OutputSettings {
                    width: 1080,
                    height: 1080,
                    fps: 24,
                    crf: 24,
                    fit: ImageFit::Contain,
                },
            ),
            (
                "portrait",
                OutputSettings {
                    width: 1080,
                    height: 1920,
                    fps: 60,
                    crf: 16,
                    fit: ImageFit::Cover,
                },
            ),
        ] {
            let output = dir.path().join(format!("{name}.mp4"));
            let info = encode_video(
                audio.to_str().unwrap(),
                cover.to_str().unwrap(),
                output.to_str().unwrap(),
                settings,
            )
            .unwrap();
            assert!((info.duration_seconds - 1.2).abs() < 0.2);
            assert!(info.size_bytes > 0);
        }
    }
}

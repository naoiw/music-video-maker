use crate::{audio, audio_filters, encode_job, ffmpeg::Tool, visual};
use encode_job::{EncodeJob, Phase};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static ENCODE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ImageFit {
    Blurred,
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
            fit: ImageFit::Blurred,
        }
    }
}

impl OutputSettings {
    fn validate(self) -> Result<(), String> {
        let size = (self.width, self.height);
        if ![(1920, 1080), (1080, 1080), (1080, 1920)].contains(&size) {
            return Err("非対応の出力解像度です。".into());
        }
        if !matches!(self.fps, 24 | 30 | 60) || !matches!(self.crf, 16 | 20 | 24) {
            return Err("非対応の FPS または画質設定です。".into());
        }
        Ok(())
    }

    // GIFs retain their timing and frames, so compose both layers in FFmpeg.
    // Crop before downscaling to avoid oversized intermediates on extreme ratios.
    fn animated_blurred_filter(self) -> String {
        let (width, height) = (self.width, self.height);
        let (small_width, small_height) = (width / 4, height / 4);
        let max_height = height * 4 / 5;
        let sigma = f64::from(width.min(height)) * 0.02 / 4.0;
        format!(
            "format=gbrap,premultiply=inplace=1,format=rgb24,split=2[bg][fg];\
             [bg]crop=w='max(1,min(iw,ih*{width}/{height}))':h='max(1,min(ih,iw*{height}/{width}))':exact=1,\
             scale={small_width}:{small_height},gblur=sigma={sigma},scale={width}:{height},setsar=1[back];\
             [fg]scale={width}:{max_height}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[front];\
             [back][front]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1"
        )
    }

    fn filter(self) -> String {
        let (width, height) = (self.width, self.height);
        let (mode, placement) = match self.fit {
            ImageFit::Blurred => return "setsar=1".into(),
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

const MAX_OVERLAYS: usize = 8;
const COORDINATE_SCALE: u32 = 10_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OverlayLayer {
    path: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    opacity: u32,
}

impl OverlayLayer {
    fn validate(&self) -> Result<(), String> {
        if self.x >= COORDINATE_SCALE
            || self.y >= COORDINATE_SCALE
            || self.width == 0
            || self.height == 0
            || self.width > COORDINATE_SCALE - self.x
            || self.height > COORDINATE_SCALE - self.y
            || self.opacity > 100
        {
            return Err(crate::errors::tagged(
                "OUTPUT_SETTINGS",
                "レイヤーの位置・サイズ・不透明度が無効です。",
            ));
        }
        Ok(())
    }

    fn pixel_rect(&self, settings: OutputSettings) -> (u32, u32, u32, u32) {
        let x = self.x * settings.width / COORDINATE_SCALE;
        let y = self.y * settings.height / COORDINATE_SCALE;
        let right = (self.x + self.width) * settings.width / COORDINATE_SCALE;
        let bottom = (self.y + self.height) * settings.height / COORDINATE_SCALE;
        (x, y, (right - x).max(1), (bottom - y).max(1))
    }
}

impl VisualKind {
    fn from_format(format: &str) -> Result<Self, String> {
        match format {
            "PNG" => Ok(Self::Png),
            "JPEG" => Ok(Self::Jpeg),
            "GIF" => Ok(Self::Gif),
            _ => Err(crate::errors::tagged("INPUT_IMAGE", "非対応の画像形式です。")),
        }
    }
}

fn visual_input_args(path: &str, source: VisualKind, fps: &str) -> Vec<String> {
    let mut args = vec!["-protocol_whitelist", "file"];
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
                fps,
                "-c:v",
                codec,
            ]);
        }
    }
    args.extend(["-i", path]);
    args.into_iter().map(str::to_owned).collect()
}

fn layered_filter(
    base_filter: &str,
    overlays: &[(&OverlayLayer, VisualKind)],
    settings: OutputSettings,
) -> (String, String) {
    // Normalize the base cadence before framesync so a slow GIF background
    // does not limit the update rate of foreground animations.
    let fps = settings.fps;
    let mut graph = format!("[0:v]{base_filter},fps={fps},setpts=PTS-STARTPTS[base]");
    let mut previous = "base".to_owned();
    for (index, (layer, _)) in overlays.iter().enumerate() {
        let input = index + 2; // 0: base visual, 1: audio.
        let (x, y, width, height) = layer.pixel_rect(settings);
        let alpha = f64::from(layer.opacity) / 100.0;
        use std::fmt::Write;
        write!(
            graph,
            ";[{input}:v]setpts=PTS-STARTPTS,format=rgba,\
             scale=w='max(1,min({width},iw*{height}/ih))':\
             h='max(1,min({height},ih*{width}/iw))',setsar=1,\
             colorchannelmixer=aa={alpha}[layer{index}];\
             [{previous}][layer{index}]overlay=x={x}+({width}-w)/2:\
             y={y}+({height}-h)/2:shortest=1:format=auto[out{index}]"
        )
        .expect("writing to a String cannot fail");
        previous = format!("out{index}");
    }
    (graph, format!("[{previous}]"))
}

fn encoder_args(
    audio_path: &str,
    visual_path: &str,
    source: VisualKind,
    temporary_path: &str,
    settings: OutputSettings,
    filtered_duration: Option<&str>,
    overlays: &[(&OverlayLayer, VisualKind)],
) -> Vec<String> {
    let fps = settings.fps.to_string();
    let crf = settings.crf.to_string();
    let filter = if matches!(source, VisualKind::Gif) && matches!(settings.fit, ImageFit::Blurred) {
        settings.animated_blurred_filter()
    } else {
        settings.filter()
    };
    let mut args: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-nostats",
        "-progress",
        "pipe:1",
        "-xerror",
        "-y", // Only the private temporary file can be overwritten.
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    args.extend(visual_input_args(visual_path, source, &fps));
    args.extend(
        [
            "-protocol_whitelist",
            "file",
            "-f",
            if filtered_duration.is_some() {
                "wav"
            } else {
                "mp3"
            },
            "-i",
            audio_path,
        ]
        .into_iter()
        .map(str::to_owned),
    );
    if overlays.is_empty() {
        args.extend(
            ["-map", "0:v:0", "-vf", &filter]
                .into_iter()
                .map(str::to_owned),
        );
    } else {
        for (layer, kind) in overlays {
            args.extend(visual_input_args(&layer.path, *kind, &fps));
        }
        let (graph, output) = layered_filter(&filter, overlays, settings);
        args.extend([
            "-filter_complex_threads".into(),
            "1".into(),
            "-filter_complex".into(),
            graph,
            "-map".into(),
            output,
        ]);
    }
    args.extend(
        [
            "-map",
            "1:a:0",
            "-map_metadata",
            "-1",
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
        ]
        .into_iter()
        .map(str::to_owned),
    );
    if let Some(duration) = filtered_duration {
        args.extend(["-t".into(), duration.into()]);
    } else {
        args.push("-shortest".into());
    }
    args.extend(
        ["-f", "mp4", temporary_path]
            .into_iter()
            .map(str::to_owned),
    );
    args
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
        return Err(format!(
            "生成動画の映像と音声の長さが一致しません（映像 {video_duration:.3} 秒、音声 {audio_duration:.3} 秒）。"
        ));
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

struct PreparedAudio {
    _directory: tempfile::TempDir,
    path: PathBuf,
    duration: f64,
}

// Finish the whole filter chain before muxing. Some FFmpeg versions handle
// buffered audio and -shortest differently when both encoders run together.
fn prepare_audio(
    audio_path: &str,
    graph: &str,
    info: &audio::AudioInfo,
    parent: &Path,
    job: &EncodeJob,
) -> Result<PreparedAudio, String> {
    let directory = tempfile::Builder::new()
        .prefix(".music-video-maker-audio-")
        .tempdir_in(parent)
        .map_err(|error| {
            crate::errors::io_error("音声の一時フォルダを作成できません", &error, "OUTPUT_IO")
        })?;
    let path = directory.path().join("filtered.wav");
    let output = path
        .to_str()
        .ok_or_else(|| "音声の一時パスを処理できません。".to_owned())?;
    let rate = info.sample_rate.to_string();
    let channels = info.channels.to_string();
    encode_job::run_ffmpeg(
        &[
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-nostats",
            "-progress",
            "pipe:1",
            "-xerror",
            "-y",
            "-protocol_whitelist",
            "file",
            "-f",
            "mp3",
            "-i",
            audio_path,
            "-map",
            "0:a:0",
            "-map_metadata",
            "-1",
            "-af",
            graph,
            "-ar",
            &rate,
            "-ac",
            &channels,
            "-c:a",
            "pcm_f32le",
            "-f",
            "wav",
            "-rf64",
            "auto",
            output,
        ],
        job,
        Phase::Filtering,
        (0.0, 0.15),
    )?;
    job.check_cancelled()?;
    let probe = Tool::Ffprobe.run(&[
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-f",
        "wav",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        "-i",
        output,
    ])?;
    let duration = positive_duration(String::from_utf8_lossy(&probe.stdout).trim())
        .map_err(|error| crate::errors::tagged("OUTPUT_VERIFY", error))?;
    if (duration - info.duration_seconds).abs() > 0.2 {
        return Err(crate::errors::tagged(
            "OUTPUT_VERIFY",
            format!(
                "音声加工後の長さが入力と一致しません（入力 {:.3} 秒、加工後 {duration:.3} 秒）。",
                info.duration_seconds
            ),
        ));
    }
    job.check_cancelled()?;
    Ok(PreparedAudio {
        _directory: directory,
        path,
        duration,
    })
}

pub(crate) fn encode_video(
    audio_path: &str,
    visual_path: &str,
    output_path: &str,
    settings: OutputSettings,
    filters: &[audio_filters::FilterEntry],
    overlays: &[OverlayLayer],
    job: &EncodeJob,
) -> Result<VideoInfo, String> {
    job.check_cancelled()?;
    settings
        .validate()
        .map_err(|error| crate::errors::tagged("OUTPUT_SETTINGS", error))?;
    if overlays.len() > MAX_OVERLAYS {
        return Err(crate::errors::tagged(
            "OUTPUT_SETTINGS",
            "追加レイヤーは8個までです。",
        ));
    }
    for layer in overlays {
        layer.validate()?;
    }
    let _guard = ENCODE_LOCK
        .try_lock()
        .map_err(|_| "別の動画生成を実行中です。".to_owned())?;
    let destination = Path::new(output_path);
    let parent = validate_destination(destination)?;

    // Revalidate sources at export time; do not trust GUI metadata.
    let audio_info = audio::probe_audio(audio_path)?;
    let audio_graph = audio_filters::compile(filters, audio_info.sample_rate)
        .map_err(|error| crate::errors::tagged("FILTER", error))?;
    job.set_duration(audio_info.duration_seconds);
    job.check_cancelled()?;
    let image = visual::load_visual(visual_path)?;
    let source = VisualKind::from_format(image.format)?;
    let mut prepared_overlays = Vec::with_capacity(overlays.len());
    for layer in overlays {
        job.check_cancelled()?;
        let info = visual::load_visual(&layer.path)?;
        prepared_overlays.push((layer, VisualKind::from_format(info.format)?));
    }
    // Static sources use the same precomposed PNG as their preview. Animated
    // GIFs bypass this step so both layers can retain every source frame.
    let composed = if matches!(settings.fit, ImageFit::Blurred)
        && !matches!(source, VisualKind::Gif)
    {
        let canvas = visual::blurred_image(&image, settings.width, settings.height)?;
        let directory = tempfile::Builder::new()
            .prefix(".music-video-maker-image-")
            .tempdir_in(parent)
            .map_err(|error| {
                crate::errors::io_error("画像の一時フォルダを作成できません", &error, "OUTPUT_IO")
            })?;
        let path = directory.path().join("composed.png");
        canvas.save(&path).map_err(|error| match error {
            image::ImageError::IoError(error) => {
                crate::errors::io_error("合成画像を保存できません", &error, "OUTPUT_IO")
            }
            error => crate::errors::tagged("OUTPUT_IO", error),
        })?;
        Some((directory, path))
    } else {
        None
    };
    let (visual_path, source) = match &composed {
        Some((_, path)) => (
            path.to_str()
                .ok_or_else(|| "画像の一時パスを処理できません。".to_owned())?,
            VisualKind::Png,
        ),
        None => (visual_path, source),
    };
    drop(image);
    job.check_cancelled()?;

    let prepared = match audio_graph.as_deref() {
        Some(graph) => Some(prepare_audio(audio_path, graph, &audio_info, parent, job)?),
        None => None,
    };
    let duration = prepared
        .as_ref()
        .map(|audio| format!("{:.6}", audio.duration));
    let input = match &prepared {
        Some(audio) => audio
            .path
            .to_str()
            .ok_or_else(|| "音声の一時パスを処理できません。".to_owned())?,
        None => audio_path,
    };

    // Stage on the same filesystem; publish only after successful verification.
    let temporary = tempfile::Builder::new()
        .prefix(".music-video-maker-")
        .suffix(".mp4")
        .tempfile_in(parent)
        .map_err(|error| {
            crate::errors::io_error("一時ファイルを作成できません", &error, "OUTPUT_IO")
        })?
        .into_temp_path();
    let temp_path = temporary
        .to_str()
        .ok_or_else(|| "一時ファイルのパスを処理できません。".to_owned())?;

    let args = encoder_args(
        input,
        visual_path,
        source,
        temp_path,
        settings,
        duration.as_deref(),
        &prepared_overlays,
    );
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let progress = if prepared.is_some() {
        (0.15, 0.85)
    } else {
        (0.0, 1.0)
    };
    encode_job::run_ffmpeg(&args, job, Phase::Encoding, progress)?;
    job.set_phase(Phase::Verifying);
    job.check_cancelled()?;

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
    let duration_seconds = validate_output(&probe.stdout, settings)
        .map_err(|error| crate::errors::tagged("OUTPUT_VERIFY", error))?;
    if let Some(audio) = prepared
        .as_ref()
        .filter(|audio| (duration_seconds - audio.duration).abs() > 0.2)
    {
        return Err(crate::errors::tagged(
            "OUTPUT_VERIFY",
            format!(
                "動画の長さが加工音と一致しません（動画 {duration_seconds:.3} 秒、加工音 {:.3} 秒）。",
                audio.duration
            ),
        ));
    }
    let size_bytes = std::fs::metadata(temp_path)
        .map_err(|error| {
            crate::errors::io_error("出力ファイルを確認できません", &error, "OUTPUT_IO")
        })?
        .len();
    job.begin_saving()?;
    temporary.persist_noclobber(destination).map_err(|error| {
        crate::errors::io_error("動画を保存できません", &error.error, "OUTPUT_IO")
    })?;

    Ok(VideoInfo {
        duration_seconds,
        size_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overlay(path: &str, opacity: u32) -> OverlayLayer {
        OverlayLayer {
            path: path.into(),
            x: 2500,
            y: 2500,
            width: 5000,
            height: 5000,
            opacity,
        }
    }

    #[test]
    fn validates_overlay_geometry_and_opacity() {
        let mut layer = overlay("test.png", 50);
        assert!(layer.validate().is_ok());
        assert_eq!(
            layer.pixel_rect(OutputSettings::default()),
            (480, 270, 960, 540)
        );
        layer.width = 7501;
        assert!(layer.validate().is_err());
        layer.width = 0;
        assert!(layer.validate().is_err());
        layer.width = 5000;
        layer.opacity = 101;
        assert!(layer.validate().is_err());
        layer.opacity = 0;
        layer.x = u32::MAX;
        assert!(layer.validate().is_err());
    }

    #[test]
    fn layered_arguments_preserve_order_paths_and_audio_mapping() {
        let first = overlay("C:/素材/first %d.png", 100);
        let second = overlay("C:/素材/second.gif", 50);
        let args = encoder_args(
            "music.mp3",
            "base.png",
            VisualKind::Png,
            "out.mp4",
            OutputSettings::default(),
            None,
            &[(&first, VisualKind::Png), (&second, VisualKind::Gif)],
        );
        let paths: Vec<&str> = args
            .windows(2)
            .filter(|pair| pair[0] == "-i")
            .map(|pair| pair[1].as_str())
            .collect();
        assert_eq!(
            paths,
            ["base.png", "music.mp3", first.path.as_str(), second.path.as_str()]
        );
        assert!(args.windows(2).any(|pair| pair == ["-map", "[out1]"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "1:a:0"]));
        assert!(args.windows(2).any(|pair| pair == ["-ignore_loop", "1"]));
        let graph = &args[args
            .iter()
            .position(|arg| arg == "-filter_complex")
            .unwrap()
            + 1];
        assert!(graph.contains("[2:v]"));
        assert!(graph.contains("[3:v]"));
        assert!(graph.contains("[out0][layer1]overlay"));
        assert!(graph.contains("colorchannelmixer=aa=0.5"));
        assert!(!graph.contains(&first.path));
        assert!(!args.iter().any(|arg| arg == "-vf"));
    }

    #[test]
    #[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
    fn encodes_ordered_overlays_with_source_alpha() {
        use image::{Rgb, RgbImage, Rgba, RgbaImage};

        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("music.mp3");
        let base = dir.path().join("base.png");
        let first = dir.path().join("first.png");
        let second = dir.path().join("second.png");
        let output = dir.path().join("result.mp4");
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
        RgbImage::from_pixel(160, 90, Rgb([0, 0, 255]))
            .save(&base)
            .unwrap();
        RgbImage::from_pixel(100, 100, Rgb([255, 0, 0]))
            .save(&first)
            .unwrap();
        RgbaImage::from_pixel(100, 100, Rgba([0, 255, 0, 128]))
            .save(&second)
            .unwrap();
        let info = encode_video(
            audio.to_str().unwrap(),
            base.to_str().unwrap(),
            output.to_str().unwrap(),
            OutputSettings {
                fit: ImageFit::Contain,
                ..OutputSettings::default()
            },
            &[],
            &[
                overlay(first.to_str().unwrap(), 100),
                overlay(second.to_str().unwrap(), 50),
            ],
            &EncodeJob::default(),
        )
        .unwrap();
        assert!((info.duration_seconds - 1.2).abs() < 0.2);
        let center = sample_color(&output, "0.5");
        // Red covered by 25% green (source alpha 50% × layer opacity 50%).
        assert!(center[0] > 160 && (35..100).contains(&center[1]) && center[2] < 30);
        let corner = sample_color_at(&output, "0.5", "crop=2:2:20:20,format=rgb24");
        assert!(corner[0] < 30 && corner[1] < 30 && corner[2] > 200);
    }

    #[test]
    fn arguments_keep_paths_separate_and_map_only_requested_streams() {
        let args = encoder_args(
            "music file.mp3",
            "cover %d.png",
            VisualKind::Png,
            "temp.mp4",
            OutputSettings::default(),
            None,
            &[],
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
            None,
            &[],
        );
        assert!(args.windows(2).any(|pair| pair == ["-f", "gif"]));
        assert!(args.windows(2).any(|pair| pair == ["-ignore_loop", "1"]));
        assert!(args.windows(2).any(|pair| pair == ["-stream_loop", "-1"]));
        assert!(args.iter().any(|arg| arg.contains("gblur=sigma=")));
        assert!(args
            .iter()
            .any(|arg| arg.contains("overlay=(W-w)/2:(H-h)/2")));
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
                &[],
                &[],
                &EncodeJob::default(),
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
                &[],
                &[],
                &EncodeJob::default(),
            )
            .is_err());
        }
    }

    fn sample_color(path: &Path, timestamp: &str) -> Vec<u8> {
        sample_color_at(path, timestamp, "crop=2:2:960:540,format=rgb24")
    }

    fn sample_color_at(path: &Path, timestamp: &str, filter: &str) -> Vec<u8> {
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
                filter,
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

            for (mode, fit) in [
                ("contain", ImageFit::Contain),
                ("cover", ImageFit::Cover),
                ("blurred", ImageFit::Blurred),
            ] {
                let output = dir.path().join(format!("{name}-{mode}.mp4"));
                let info = encode_video(
                    audio.to_str().unwrap(),
                    cover.to_str().unwrap(),
                    output.to_str().unwrap(),
                    OutputSettings {
                        fit,
                        ..OutputSettings::default()
                    },
                    &[],
                    &[],
                    &EncodeJob::default(),
                )
                .unwrap();
                assert!((info.duration_seconds - 2.3).abs() < 0.2);
                assert!(info.size_bytes > 0);

                // Test both foreground and, in blurred mode, background well
                // after the original GIF ends. Do not only probe duration.
                for (timestamp, red) in [
                    ("0.1", true),
                    ("0.35", false),
                    ("1.6", true),
                    ("1.85", false),
                    ("2.1", true),
                ] {
                    let foreground = sample_color(&output, timestamp);
                    let mut pixels = vec![foreground];
                    if matches!(fit, ImageFit::Blurred) {
                        pixels.push(sample_color_at(
                            &output,
                            timestamp,
                            "crop=2:2:960:50,format=rgb24",
                        ));
                    }
                    for pixel in pixels {
                        assert_eq!(pixel.len(), 12);
                        if red {
                            assert!(
                                pixel[0] > 200 && pixel[2] < 50,
                                "{name}/{mode}: {timestamp}"
                            );
                        } else {
                            assert!(
                                pixel[2] > 200 && pixel[0] < 50,
                                "{name}/{mode}: {timestamp}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn validates_settings_and_generates_fit_filters() {
        let defaults = OutputSettings::default();
        assert!(defaults.validate().is_ok());
        assert_eq!(defaults.filter(), "setsar=1");
        let contain = OutputSettings {
            fit: ImageFit::Contain,
            ..defaults
        };
        assert!(contain.filter().contains("pad=1920:1080"));
        let cover = OutputSettings {
            width: 1080,
            height: 1920,
            fps: 60,
            crf: 16,
            fit: ImageFit::Cover,
        };
        assert!(cover.validate().is_ok());
        assert!(cover.filter().contains("crop=1080:1920"));
        let args = encoder_args("a.mp3", "b.png", VisualKind::Png, "c.mp4", cover, None, &[]);
        for expected in [["-framerate", "60"], ["-r", "60"], ["-crf", "16"]] {
            assert!(args.windows(2).any(|pair| pair == expected));
        }
        let mut invalid = defaults;
        invalid.width = 1;
        assert!(invalid.validate().is_err());
        invalid = defaults;
        invalid.fps = 0;
        assert!(invalid.validate().is_err());
        invalid = defaults;
        invalid.crf = 99;
        assert!(invalid.validate().is_err());
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
        let image = image::DynamicImage::new_rgb8(640, 640);
        image.save(&cover).unwrap();
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
                &[],
                &[],
                &EncodeJob::default(),
            )
            .unwrap();
            assert!((info.duration_seconds - 1.2).abs() < 0.2);
            assert!(info.size_bytes > 0);
        }
    }

    #[test]
    #[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
    fn encodes_cancel_and_retry() {
        use std::thread;
        use std::time::{Duration, Instant};

        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("song.mp3");
        let cover = dir.path().join("cover.png");
        let output = dir.path().join("cancelled.mp4");
        let fixture = |duration: &str| {
            Tool::Ffmpeg
                .run(&[
                    "-v",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    duration,
                    "-c:a",
                    "libmp3lame",
                    audio.to_str().unwrap(),
                ])
                .unwrap();
        };
        fixture("sine=frequency=440:duration=30");
        image::DynamicImage::new_rgb8(640, 480)
            .save(&cover)
            .unwrap();

        let job = EncodeJob::default();
        let result = thread::scope(|scope| {
            let worker = scope.spawn(|| {
                encode_video(
                    audio.to_str().unwrap(),
                    cover.to_str().unwrap(),
                    output.to_str().unwrap(),
                    OutputSettings::default(),
                    &[],
                    &[],
                    &job,
                )
            });
            let deadline = Instant::now() + Duration::from_secs(20);
            while job.snapshot().processed_seconds <= 0.0 && Instant::now() < deadline {
                if worker.is_finished() {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
            let saw_progress = job.snapshot().processed_seconds > 0.0;
            let accepted = job.request_cancel();
            let result = worker.join().unwrap();
            assert!(saw_progress);
            assert!(accepted);
            result
        });
        assert_eq!(result.unwrap_err(), encode_job::CANCELLED);
        assert!(!output.exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);

        fixture("sine=frequency=440:duration=1.2");
        let info = encode_video(
            audio.to_str().unwrap(),
            cover.to_str().unwrap(),
            output.to_str().unwrap(),
            OutputSettings::default(),
            &[],
            &[],
            &EncodeJob::default(),
        )
        .unwrap();
        assert!(info.size_bytes > 0);
        assert!(output.is_file());
    }

    #[test]
    fn uses_explicit_duration_for_prepared_audio() {
        let args = encoder_args(
            "a.mp3",
            "b.png",
            VisualKind::Png,
            "out.mp4",
            OutputSettings::default(),
            None,
            &[],
        );
        assert!(!args.iter().any(|arg| arg == "-af"));
        let args = encoder_args(
            "filtered.wav",
            "b.png",
            VisualKind::Png,
            "out.mp4",
            OutputSettings::default(),
            Some("3.200000"),
            &[],
        );
        assert!(args.windows(2).any(|pair| pair == ["-f", "wav"]));
        assert!(args.windows(2).any(|pair| pair == ["-t", "3.200000"]));
        assert!(!args.iter().any(|arg| arg == "-shortest" || arg == "-af"));
    }

    fn audio_rms(path: &Path) -> f64 {
        let output = Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-ss",
                "1",
                "-i",
                path.to_str().unwrap(),
                "-map",
                "0:a:0",
                "-t",
                "1",
                "-f",
                "f32le",
                "-acodec",
                "pcm_f32le",
                "-",
            ])
            .unwrap();
        let (samples, remainder) = output.stdout.as_chunks::<4>();
        assert!(remainder.is_empty());
        assert!(!samples.is_empty());
        let sum: f64 = samples
            .iter()
            .map(|sample| f64::from(f32::from_le_bytes(*sample)).powi(2))
            .sum();
        (sum / samples.len() as f64).sqrt()
    }

    #[test]
    #[ignore = "requires FFmpeg with audio filters, libmp3lame, libx264, AAC and FFprobe"]
    fn encodes_with_audio_filter_chain() {
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("song.mp3");
        let image = dir.path().join("cover.png");
        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:sample_rate=48000:duration=3.2",
                "-c:a",
                "libmp3lame",
                audio.to_str().unwrap(),
            ])
            .unwrap();
        image::DynamicImage::new_rgb8(512, 512)
            .save(&image)
            .unwrap();
        let original_bytes = std::fs::read(&audio).unwrap();
        let settings = OutputSettings {
            width: 1080,
            height: 1080,
            ..OutputSettings::default()
        };
        let cases = [
            ("original", "[]"),
            (
                "disabled",
                r#"[{"enabled":false,"filter":{"kind":"gain","gainDb":-6}}]"#,
            ),
            (
                "gain",
                r#"[{"enabled":true,"filter":{"kind":"gain","gainDb":-6}}]"#,
            ),
            (
                "combined",
                r#"[
                    {"enabled":true,"filter":{"kind":"noiseReduction","reductionDb":6,"noiseFloorDb":-50}},
                    {"enabled":true,"filter":{"kind":"highPass","frequencyHz":80}},
                    {"enabled":true,"filter":{"kind":"lowPass","frequencyHz":12000}},
                    {"enabled":true,"filter":{"kind":"equalizer","frequencyHz":1000,"q":1,"gainDb":3}},
                    {"enabled":true,"filter":{"kind":"gain","gainDb":-6}},
                    {"enabled":true,"filter":{"kind":"loudness","targetLufs":-14,"truePeakDb":-1.5}},
                    {"enabled":true,"filter":{"kind":"limiter","ceilingDb":-1}}
                ]"#,
            ),
        ];
        let mut levels = Vec::new();
        for (name, json) in cases {
            let filters: Vec<audio_filters::FilterEntry> = serde_json::from_str(json).unwrap();
            let output = dir.path().join(format!("{name}.mp4"));
            let info = encode_video(
                audio.to_str().unwrap(),
                image.to_str().unwrap(),
                output.to_str().unwrap(),
                settings,
                &filters,
                &[],
                &EncodeJob::default(),
            )
            .unwrap_or_else(|error| panic!("{name}: {error}"));
            assert!((info.duration_seconds - 3.2).abs() < 0.2, "{name}");
            levels.push(audio_rms(&output));
        }
        assert!((levels[1] / levels[0] - 1.0).abs() < 0.01);
        assert!((levels[2] / levels[0] - 10_f64.powf(-6.0 / 20.0)).abs() < 0.03);
        assert!(levels[3].is_finite() && levels[3] > 0.0);
        assert_eq!(std::fs::read(&audio).unwrap(), original_bytes);

        let invalid: Vec<audio_filters::FilterEntry> =
            serde_json::from_str(r#"[{"enabled":true,"filter":{"kind":"gain","gainDb":99}}]"#)
                .unwrap();
        let output = dir.path().join("invalid.mp4");
        assert!(encode_video(
            audio.to_str().unwrap(),
            image.to_str().unwrap(),
            output.to_str().unwrap(),
            settings,
            &invalid,
            &[],
            &EncodeJob::default(),
        )
        .is_err());
        assert!(!output.exists());
        assert!(!std::fs::read_dir(dir.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".music-video-maker-")
        }));
    }

    #[test]
    fn accepts_every_supported_output_settings_combination() {
        for (width, height) in [(1920, 1080), (1080, 1080), (1080, 1920)] {
            for fps in [24, 30, 60] {
                for crf in [16, 20, 24] {
                    for fit in [ImageFit::Blurred, ImageFit::Contain, ImageFit::Cover] {
                        let settings = OutputSettings {
                            width,
                            height,
                            fps,
                            crf,
                            fit,
                        };
                        assert!(settings.validate().is_ok());
                        let args = encoder_args(
                            "audio.mp3",
                            "cover.png",
                            VisualKind::Png,
                            "out.mp4",
                            settings,
                            None,
                            &[],
                        );
                        for (flag, value) in [
                            ("-r", fps.to_string()),
                            ("-crf", crf.to_string()),
                            ("-c:v", "libx264".into()),
                            ("-c:a", "aac".into()),
                            ("-pix_fmt", "yuv420p".into()),
                            ("-movflags", "+faststart".into()),
                        ] {
                            assert!(args
                                .windows(2)
                                .any(|pair| pair[0] == flag && pair[1] == value));
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn output_verification_rejects_each_invalid_stream_property() {
        let valid = serde_json::json!({
            "streams": [
                {"codec_type":"video","codec_name":"h264","width":1920,"height":1080,
                 "pix_fmt":"yuv420p","r_frame_rate":"30/1","duration":"2.0"},
                {"codec_type":"audio","codec_name":"aac","duration":"2.01"}
            ],
            "format":{"duration":"2.01"}
        });
        let settings = OutputSettings::default();
        let check = |value: &serde_json::Value| {
            validate_output(&serde_json::to_vec(value).unwrap(), settings)
        };
        assert_eq!(check(&valid).unwrap(), 2.01);
        for (index, key, value) in [
            (0_usize, "codec_name", serde_json::json!("hevc")),
            (1, "codec_name", serde_json::json!("mp3")),
            (0, "width", serde_json::json!(1080)),
            (0, "height", serde_json::json!(720)),
            (0, "pix_fmt", serde_json::json!("yuv444p")),
            (0, "r_frame_rate", serde_json::json!("60/1")),
            (0, "duration", serde_json::json!("2.4")),
            (1, "duration", serde_json::json!("N/A")),
        ] {
            let mut invalid = valid.clone();
            invalid["streams"][index][key] = value;
            assert!(check(&invalid).is_err(), "{key}");
        }
        let mut extra = valid.clone();
        extra["streams"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"codec_type":"audio","codec_name":"aac"}));
        assert!(check(&extra).is_err());
        let mut invalid_duration = valid;
        invalid_duration["format"]["duration"] = serde_json::json!("NaN");
        assert!(check(&invalid_duration).is_err());
    }

    #[test]
    #[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
    fn encodes_after_invalid_sources_and_verifies_published_file() {
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("音声 test.mp3");
        let cover = dir.path().join("画像 %d.png");
        let output = dir.path().join("出力 test.mp4");
        let audio_path = audio.to_str().unwrap();
        let cover_path = cover.to_str().unwrap();
        let output_path = output.to_str().unwrap();
        let settings = OutputSettings {
            width: 1080,
            height: 1080,
            fps: 24,
            crf: 24,
            fit: ImageFit::Cover,
        };
        let filters: Vec<audio_filters::FilterEntry> =
            serde_json::from_str(r#"[{"enabled":true,"filter":{"kind":"gain","gainDb":-6}}]"#)
                .unwrap();
        let encode = || {
            encode_video(
                audio_path,
                cover_path,
                output_path,
                settings,
                &filters,
                &[],
                &EncodeJob::default(),
            )
        };
        image::DynamicImage::new_rgb8(513, 777)
            .save(&cover)
            .unwrap();
        std::fs::write(&audio, b"not an MP3").unwrap();
        assert!(encode().is_err());
        assert!(!output.exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);

        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=44100:duration=1.5",
                "-c:a",
                "libmp3lame",
                audio_path,
            ])
            .unwrap();
        let original = std::fs::read(&audio).unwrap();
        std::fs::write(&cover, b"not a PNG").unwrap();
        assert!(encode().unwrap_err().starts_with("[MVM:INPUT_IMAGE]"));
        assert!(!output.exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);

        image::DynamicImage::new_rgb8(513, 777)
            .save(&cover)
            .unwrap();
        let info = encode().unwrap();
        assert!(info.size_bytes > 0);
        assert_eq!(info.size_bytes, std::fs::metadata(&output).unwrap().len());
        // Probe the published MP4 independently of the application's validator.
        let probe = Tool::Ffprobe
            .run(&[
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                output_path,
            ])
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
        let streams = result["streams"].as_array().unwrap();
        assert_eq!(streams.len(), 2);
        let video = streams
            .iter()
            .find(|stream| stream["codec_type"] == "video")
            .unwrap();
        let audio_stream = streams
            .iter()
            .find(|stream| stream["codec_type"] == "audio")
            .unwrap();
        assert_eq!(video["codec_name"], "h264");
        assert_eq!(video["width"], 1080);
        assert_eq!(video["height"], 1080);
        assert_eq!(video["pix_fmt"], "yuv420p");
        assert_eq!(video["r_frame_rate"], "24/1");
        assert_eq!(audio_stream["codec_name"], "aac");
        for stream in [video, audio_stream, &result["format"]] {
            let duration: f64 = stream["duration"].as_str().unwrap().parse().unwrap();
            assert!((duration - 1.5).abs() < 0.2, "{duration}");
        }
        let published = std::fs::read(&output).unwrap();
        assert!(encode().unwrap_err().starts_with("[MVM:OUTPUT_EXISTS]"));
        assert_eq!(std::fs::read(&output).unwrap(), published);
        assert_eq!(std::fs::read(&audio).unwrap(), original);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 3);
    }
}

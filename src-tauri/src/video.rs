use crate::{audio, audio_filters, encode_job, ffmpeg::Tool, visual};
use encode_job::{EncodeJob, Phase};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

mod arguments;
mod output;

use arguments::{encoder_args, VisualKind};
use output::{positive_duration, validate_destination, validate_output};

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
            "-format_whitelist",
            audio::AUDIO_FORMATS,
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
mod tests;

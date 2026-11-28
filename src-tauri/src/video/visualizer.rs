//! Render finite audio-driven intermediates before compositing infinite visuals.

use super::{output::positive_duration, OutputSettings};
use crate::{
    audio, encode_job,
    encode_job::{EncodeJob, Phase},
    errors, ffmpeg::Tool,
};
use serde::Deserialize;
use std::path::Path;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Style {
    Waveform,
    Frequency,
    Volume,
    Spectrogram,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum AudioSource {
    Original,
    Processed,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Visualizer {
    pub(super) style: Style,
    pub(super) audio_source: AudioSource,
    pub(super) color: String,
    pub(super) transparent: bool,
}

impl Visualizer {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.color.len() != 7
            || !self.color.starts_with('#')
            || !self.color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        {
            return Err(errors::tagged(
                "OUTPUT_SETTINGS",
                "ビジュアライザーの色が無効です。",
            ));
        }
        Ok(())
    }

    pub(super) fn filter(&self, fps: u32, duration: &str) -> String {
        let color = &self.color[1..];
        let draw = match self.style {
            Style::Waveform => format!(
                "showwaves=s=640x180:mode=line:rate={fps}:colors=0x{color}|0x{color}:draw=full"
            ),
            Style::Frequency => format!(
                "showfreqs=s=640x180:rate={fps}:mode=bar:fscale=log:ascale=log:win_size=2048:colors=0x{color}|0x{color}"
            ),
            Style::Volume => {
                // showvolume's color expression packs RGBA with red in the low byte.
                let packed = format!("0xFF{}{}{}", &color[4..6], &color[2..4], &color[..2]);
                format!("showvolume=w=640:h=90:r={fps}:b=0:t=0:v=0:p=0:c={packed}:f=0.8")
            }
            Style::Spectrogram => format!(
                "showspectrum=s=640x256:slide=scroll:color=magma:scale=log:fscale=log:legend=0:fps={fps}"
            ),
        };
        // Add a little silence to flush short/final analysis windows. Never loop
        // the visualizer: its first frame corresponds to the beginning of audio.
        format!(
            "asetpts=N/SR/TB,apad=pad_dur=0.5,{draw},fps={fps},setpts=PTS-STARTPTS,\
             tpad=stop_mode=clone:stop_duration=0.2,trim=duration={duration},format=bgr0"
        )
    }
}

pub(super) fn render(
    visualizer: &Visualizer,
    audio_path: &str,
    output_path: &str,
    settings: OutputSettings,
    duration: &str,
    job: &EncodeJob,
    progress: (f64, f64),
) -> Result<(), String> {
    let filter = format!("[0:a:0]{}[v]", visualizer.filter(settings.fps, duration));
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
            "-filter_complex_threads",
            "1",
            "-filter_complex",
            &filter,
            "-map",
            "[v]",
            "-an",
            "-c:v",
            "ffv1",
            "-threads",
            "2",
            "-pix_fmt",
            "bgr0",
            "-t",
            duration,
            "-f",
            "matroska",
            output_path,
        ],
        job,
        Phase::Filtering,
        progress,
    )?;
    job.check_cancelled()?;
    let probe = Tool::Ffprobe.run(&[
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-f",
        "matroska",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        "-i",
        output_path,
    ])?;
    let actual = positive_duration(String::from_utf8_lossy(&probe.stdout).trim())
        .map_err(|error| errors::tagged("OUTPUT_VERIFY", error))?;
    let expected = positive_duration(duration)
        .map_err(|error| errors::tagged("OUTPUT_VERIFY", error))?;
    if (actual - expected).abs() > 0.2 {
        return Err(errors::tagged(
            "OUTPUT_VERIFY",
            format!("ビジュアライザーの長さが一致しません（{actual:.3} / {expected:.3} 秒）。"),
        ));
    }
    job.check_cancelled()
}

//! Stream floating-point PCM and send only bounded analysis summaries to the UI.

mod fft;

use crate::{audio, audio_filters, errors, ffmpeg::Tool};
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::process::Stdio;
use std::sync::Mutex;

const MAX_SECONDS: u64 = 3600;
const TARGET_BINS: u64 = 1024;
const MAX_BINS: usize = 2048;
static ANALYSIS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Serialize)]
struct Envelope {
    min: f32,
    max: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    duration_seconds: f64,
    frames_per_bin: u64,
    waveform: Vec<Envelope>,
    peak: f64,
    rms: f64,
    over_range_samples: u64,
    spectrum_db: Vec<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Comparison {
    sample_rate: u32,
    channels: u32,
    fft_size: usize,
    original: Track,
    processed: Track,
}

struct Summary {
    rate: u32,
    channels: usize,
    frames: u64,
    frames_per_bin: u64,
    waveform: Vec<Envelope>,
    peak: f64,
    squares: f64,
    over_range_samples: u64,
    spectrum: fft::Spectrum,
}

impl Summary {
    fn new(rate: u32, channels: usize, duration: f64) -> Self {
        let frames = (duration * f64::from(rate)).ceil() as u64;
        Self {
            rate,
            channels,
            frames: 0,
            frames_per_bin: frames.div_ceil(TARGET_BINS).max(1),
            waveform: Vec::new(),
            peak: 0.0,
            squares: 0.0,
            over_range_samples: 0,
            spectrum: fft::Spectrum::new(),
        }
    }

    fn add(&mut self, samples: &[f32]) -> Result<(), String> {
        if self.frames + (samples.len() / self.channels) as u64 > MAX_SECONDS * u64::from(self.rate)
        {
            return Err("音声解析は60分以下の素材に対応します。".into());
        }
        for frame in samples.chunks_exact(self.channels) {
            if self.frames.is_multiple_of(self.frames_per_bin) {
                if self.waveform.len() == MAX_BINS {
                    // The metadata can underestimate the decoded duration.
                    // Merge complete adjacent buckets, preserving their extrema.
                    self.waveform = self
                        .waveform
                        .chunks_exact(2)
                        .map(|pair| Envelope {
                            min: pair[0].min.min(pair[1].min),
                            max: pair[0].max.max(pair[1].max),
                        })
                        .collect();
                    self.frames_per_bin *= 2;
                }
                self.waveform.push(Envelope {
                    min: f32::INFINITY,
                    max: f32::NEG_INFINITY,
                });
            }
            let bin = self.waveform.last_mut().expect("waveform bucket");
            for &sample in frame {
                if !sample.is_finite() {
                    return Err("音声解析で非有限のPCM値を検出しました。".into());
                }
                bin.min = bin.min.min(sample);
                bin.max = bin.max.max(sample);
                let value = f64::from(sample);
                self.peak = self.peak.max(value.abs());
                self.squares += value * value;
                if value.abs() > 1.0 {
                    self.over_range_samples += 1;
                }
            }
            self.frames += 1;
        }
        self.spectrum.add(samples, self.channels);
        Ok(())
    }

    fn finish(self) -> Result<Track, String> {
        if self.frames == 0 {
            return Err("解析可能なPCM音声がありません。".into());
        }
        Ok(Track {
            duration_seconds: self.frames as f64 / f64::from(self.rate),
            frames_per_bin: self.frames_per_bin,
            waveform: self.waveform,
            peak: self.peak,
            rms: (self.squares / (self.frames as f64 * self.channels as f64)).sqrt(),
            over_range_samples: self.over_range_samples,
            spectrum_db: self.spectrum.finish(),
        })
    }
}

fn read_pcm(mut reader: impl Read, info: &audio::AudioInfo) -> Result<Track, String> {
    let mut summary = Summary::new(
        info.sample_rate,
        info.channels as usize,
        info.duration_seconds,
    );
    let frame_bytes = info.channels as usize * 4;
    let mut buffer = vec![0; fft::SIZE * frame_bytes];
    let mut samples = Vec::with_capacity(fft::SIZE * info.channels as usize);
    loop {
        let mut filled = 0;
        while filled < buffer.len() {
            let count = reader
                .read(&mut buffer[filled..])
                .map_err(|error| errors::io_error("PCMの読み込み", &error, "INPUT_AUDIO"))?;
            if count == 0 {
                break;
            }
            filled += count;
        }
        if filled == 0 {
            break;
        }
        if !filled.is_multiple_of(frame_bytes) {
            return Err("PCMのフレーム境界が無効です。".into());
        }
        samples.clear();
        samples.extend(
            buffer[..filled]
                .chunks_exact(4)
                .map(|bytes| f32::from_le_bytes(bytes.try_into().expect("four bytes"))),
        );
        summary.add(&samples)?;
        if filled < buffer.len() {
            break;
        }
    }
    summary.finish()
}

fn analyze_track(path: &str, info: &audio::AudioInfo, graph: Option<&str>) -> Result<Track, String> {
    let mut stderr = tempfile::tempfile()
        .map_err(|error| errors::io_error("解析用一時ファイル", &error, "OUTPUT_IO"))?;
    let stderr_output = stderr.try_clone().map_err(|error| error.to_string())?;
    let rate = info.sample_rate.to_string();
    let channels = info.channels.to_string();
    let mut args = vec![
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-xerror",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        audio::AUDIO_FORMATS,
        "-i",
        path,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
    ];
    if let Some(graph) = graph {
        args.extend(["-af", graph]);
    }
    args.extend([
        "-ar",
        &rate,
        "-ac",
        &channels,
        "-c:a",
        "pcm_f32le",
        "-f",
        "f32le",
        "-",
    ]);
    let mut child = Tool::Ffmpeg
        .command()
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(stderr_output))
        .spawn()
        .map_err(|error| errors::tool_start_error("FFmpeg", &error))?;
    let result = match child.stdout.take() {
        Some(stdout) => read_pcm(stdout, info),
        None => Err("FFmpegのPCMを取得できません。".into()),
    };
    // On early rejection (e.g. actual duration limit), close the pipe and
    // terminate the producer rather than waiting for an unconsumed stream.
    if result.is_err() {
        let _ = child.kill();
    }
    let status = child
        .wait()
        .map_err(|error| errors::tool_start_error("FFmpeg", &error))?;
    // A rejected stream may have been deliberately killed; retain the
    // analysis error rather than reporting a secondary broken pipe.
    if !status.success() && result.is_ok() {
        stderr
            .seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        let mut detail = Vec::new();
        stderr
            .take(8192)
            .read_to_end(&mut detail)
            .map_err(|error| error.to_string())?;
        return Err(errors::process_error("FFmpeg analysis", status, &detail));
    }
    result
}

pub(crate) fn analyze(
    path: &str,
    filters: &[audio_filters::FilterEntry],
) -> Result<Comparison, String> {
    let _guard = ANALYSIS_LOCK
        .try_lock()
        .map_err(|_| "別の音声解析を実行中です。".to_owned())?;
    let info = audio::probe_audio(path)?;
    if info.duration_seconds > MAX_SECONDS as f64 {
        return Err("音声解析は60分以下の素材に対応します。".into());
    }
    let graph = audio_filters::compile(filters, info.sample_rate)
        .map_err(|error| errors::tagged("FILTER", error))?;
    let original = analyze_track(path, &info, None)?;
    let processed = match graph.as_deref() {
        Some(graph) => analyze_track(path, &info, Some(graph))?,
        None => original.clone(),
    };
    Ok(Comparison {
        sample_rate: info.sample_rate,
        channels: info.channels,
        fft_size: fft::SIZE,
        original,
        processed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_retains_extrema_and_counts_over_range_after_merging() {
        let mut summary = Summary::new(8000, 2, 0.01);
        let mut samples = vec![0.0; 4096 * 2];
        samples[0] = -1.5;
        samples[1] = 0.5;
        samples[4096 * 2 - 1] = 2.0;
        summary.add(&samples).unwrap();
        let track = summary.finish().unwrap();
        assert_eq!(track.frames_per_bin, 2);
        assert_eq!(track.waveform.len(), 2048);
        assert_eq!(track.waveform[0].min, -1.5);
        assert_eq!(track.waveform[2047].max, 2.0);
        assert_eq!(track.peak, 2.0);
        assert_eq!(track.over_range_samples, 2);
        assert!((track.rms - (6.5_f64 / 8192.0).sqrt()).abs() < 1e-10);
        let mut invalid = Summary::new(8000, 1, 0.01);
        assert!(invalid.add(&[f32::NAN]).is_err());
    }

    #[test]
    #[ignore = "requires FFmpeg and FFprobe"]
    fn compares_full_track_with_gain_and_preserves_source() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("tone.wav");
        let path = source.to_str().unwrap();
        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:sample_rate=48000:duration=2",
                "-c:a",
                "pcm_s16le",
                path,
            ])
            .unwrap();
        let before = std::fs::read(&source).unwrap();
        let filters: Vec<audio_filters::FilterEntry> =
            serde_json::from_str(r#"[{"enabled":true,"filter":{"kind":"gain","gainDb":-6}}]"#)
                .unwrap();
        let result = analyze(path, &filters).unwrap();
        let original = &result.original;
        let processed = &result.processed;
        assert_eq!(result.sample_rate, 48_000);
        assert_eq!(original.duration_seconds, 2.0);
        assert_eq!(processed.duration_seconds, 2.0);
        assert_eq!(original.frames_per_bin, processed.frames_per_bin);
        assert_eq!(original.waveform.len(), processed.waveform.len());
        assert!((processed.peak / original.peak - 10_f64.powf(-0.3)).abs() < 0.001);
        assert!((processed.rms / original.rms - 10_f64.powf(-0.3)).abs() < 0.001);
        let bin = (1000.0 * fft::SIZE as f64 / 48_000.0).round() as usize;
        assert!((processed.spectrum_db[bin] - original.spectrum_db[bin] + 6.0).abs() < 0.01);
        let bypass = analyze(path, &[]).unwrap();
        assert_eq!(bypass.original.spectrum_db, bypass.processed.spectrum_db);
        assert_eq!(std::fs::read(&source).unwrap(), before);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}

use crate::{audio, audio_filters, ffmpeg::Tool};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::sync::Mutex;

const PREVIEW_SECONDS: u32 = 30;
const MAX_WAV_BYTES: u64 = 6 * 1024 * 1024;
static PREVIEW_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioPreview {
    wav_base64: String,
}

fn validate_start(start: f64, duration: f64) -> Result<(), String> {
    if !start.is_finite() || start < 0.0 || start >= duration {
        return Err("試聴の開始位置が音声の範囲外です。".into());
    }
    Ok(())
}

pub(crate) fn render(
    path: &str,
    start_seconds: f64,
    filters: &[audio_filters::FilterEntry],
) -> Result<AudioPreview, String> {
    let _guard = PREVIEW_LOCK
        .try_lock()
        .map_err(|_| "別の音声プレビューを生成中です。".to_owned())?;
    let info = audio::probe_audio(path)?;
    validate_start(start_seconds, info.duration_seconds)?;
    if !(8_000..=48_000).contains(&info.sample_rate) || !(1..=2).contains(&info.channels) {
        return Err("非対応の音声形式です。".into());
    }
    let graph = audio_filters::compile(filters, info.sample_rate)?;
    let temporary = tempfile::tempdir().map_err(|error| error.to_string())?;
    let output = temporary.path().join("preview.wav");
    let output_path = output
        .to_str()
        .ok_or_else(|| "一時ファイルのパスを処理できません。".to_owned())?;
    let start = format!("{start_seconds:.6}");
    let duration = PREVIEW_SECONDS.to_string();
    let rate = info.sample_rate.to_string();
    let channels = info.channels.to_string();
    let mut args = vec![
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-xerror",
        "-y",
        "-protocol_whitelist",
        "file",
        "-f",
        "mp3",
        "-i",
        path,
        "-map",
        "0:a:0",
        "-map_metadata",
        "-1",
    ];
    if let Some(graph) = &graph {
        args.extend(["-af", graph.as_str()]);
    }
    // Output-side seek: process the preceding audio before selecting the excerpt.
    args.extend([
        "-ss",
        &start,
        "-t",
        &duration,
        "-ar",
        &rate,
        "-ac",
        &channels,
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        output_path,
    ]);
    Tool::Ffmpeg.run(&args)?;
    let size = output.metadata().map_err(|error| error.to_string())?.len();
    if size > MAX_WAV_BYTES || size <= 44 {
        return Err("試聴データのサイズが無効です。".into());
    }
    let bytes = std::fs::read(output).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_WAV_BYTES
        || !bytes.starts_with(b"RIFF")
        || bytes.get(8..12) != Some(b"WAVE".as_slice())
    {
        return Err("試聴データの形式が無効です。".into());
    }
    // TempDir removes the WAV on success and all ordinary error paths.
    Ok(AudioPreview {
        wav_base64: STANDARD.encode(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_preview_start() {
        for value in [-1.0, 35.0, 36.0, f64::NAN, f64::INFINITY] {
            assert!(validate_start(value, 35.0).is_err());
        }
        assert!(validate_start(0.0, 35.0).is_ok());
        assert!(validate_start(34.0, 35.0).is_ok());
    }

    fn decoded_pcm(preview: AudioPreview, output: &std::path::Path) -> Vec<u8> {
        std::fs::write(output, STANDARD.decode(preview.wav_base64).unwrap()).unwrap();
        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-i",
                output.to_str().unwrap(),
                "-f",
                "f32le",
                "-acodec",
                "pcm_f32le",
                "-",
            ])
            .unwrap()
            .stdout
    }

    fn rms(bytes: &[u8]) -> f64 {
        let (samples, remainder) = bytes.as_chunks::<4>();
        assert!(remainder.is_empty());
        assert!(!samples.is_empty());
        let sum: f64 = samples
            .iter()
            .map(|sample| f64::from(f32::from_le_bytes(*sample)).powi(2))
            .sum();
        (sum / samples.len() as f64).sqrt()
    }

    #[test]
    #[ignore = "requires FFmpeg with libmp3lame and FFprobe"]
    fn renders_original_filtered_and_tail_excerpts() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("music test.mp3");
        let path = source.to_str().unwrap();
        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:sample_rate=48000:duration=35",
                "-c:a",
                "libmp3lame",
                path,
            ])
            .unwrap();
        let before = std::fs::read(&source).unwrap();
        let output = dir.path().join("sample.wav");
        let filters: Vec<audio_filters::FilterEntry> =
            serde_json::from_str(r#"[{"enabled":true,"filter":{"kind":"gain","gainDb":-6}}]"#)
                .unwrap();
        let original = decoded_pcm(render(path, 2.0, &[]).unwrap(), &output);
        let filtered = decoded_pcm(render(path, 2.0, &filters).unwrap(), &output);
        assert_eq!(original.len(), 30 * 48_000 * 4);
        assert_eq!(filtered.len(), original.len());
        assert!((rms(&filtered) / rms(&original) - 10_f64.powf(-6.0 / 20.0)).abs() < 0.002);
        let tail = decoded_pcm(render(path, 34.0, &[]).unwrap(), &output);
        assert_eq!(tail.len(), 48_000 * 4);
        assert!(render(path, 99.0, &[]).is_err());
        assert_eq!(std::fs::read(&source).unwrap(), before);
    }
}

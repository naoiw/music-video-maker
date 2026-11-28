use crate::{errors, ffmpeg::Tool};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub(crate) const AUDIO_FORMATS: &str = "mp3,wav,flac,aac,mov,mp4,m4a,3gp,3g2,mj2,matroska,webm";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioInfo {
    name: String,
    pub(crate) duration_seconds: f64,
    pub(crate) sample_rate: u32,
    pub(crate) channels: u32,
    bit_rate: Option<u64>,
}

#[derive(Deserialize)]
struct ProbeResult {
    #[serde(default)]
    streams: Vec<AudioStream>,
    format: MediaFormat,
}

#[derive(Deserialize)]
struct AudioStream {
    codec_name: Option<String>,
    sample_rate: Option<String>,
    channels: Option<u32>,
    duration: Option<String>,
    bit_rate: Option<String>,
    #[serde(default)]
    tags: std::collections::HashMap<String, String>,
}

#[derive(Deserialize)]
struct MediaFormat {
    format_name: String,
    duration: Option<String>,
    bit_rate: Option<String>,
}

fn positive_duration(value: Option<&str>) -> Option<f64> {
    value?
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
}

fn extension(path: &Path) -> Option<String> {
    path.extension()?.to_str().map(str::to_ascii_lowercase)
}

fn supported_extension(ext: &str) -> bool {
    matches!(
        ext,
        "mp3" | "wav" | "flac" | "aac" | "m4a" | "mp4" | "webm" | "mov" | "mkv"
    )
}

fn matches_format(ext: &str, format: &str, codec: &str) -> bool {
    let has = |name| format.split(',').any(|part| part == name);
    match ext {
        "mp3" => has("mp3") && codec == "mp3",
        "wav" => has("wav") && codec.starts_with("pcm_"),
        "flac" => has("flac") && codec == "flac",
        "aac" => has("aac") && codec == "aac",
        "m4a" => has("mov") && matches!(codec, "aac" | "alac"),
        "mp4" | "mov" => has("mov") && matches!(codec, "aac" | "alac" | "mp3" | "opus" | "flac"),
        "mkv" => {
            has("matroska") && matches!(codec, "aac" | "flac" | "mp3" | "opus" | "vorbis" | "alac")
        }
        "webm" => has("webm") && matches!(codec, "opus" | "vorbis"),
        _ => false,
    }
}

fn tagged_duration(tags: &std::collections::HashMap<String, String>) -> Option<f64> {
    let value = tags
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("duration"))?
        .1;
    let mut parts = value.split(':');
    let hours = parts.next()?.parse::<f64>().ok()?;
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds = parts.next()?.parse::<f64>().ok()?;
    let total = hours * 3600.0 + minutes * 60.0 + seconds;
    (parts.next().is_none() && total.is_finite() && total > 0.0).then_some(total)
}

fn parse_info(name: String, bytes: &[u8]) -> Result<AudioInfo, String> {
    let probe: ProbeResult =
        serde_json::from_slice(bytes).map_err(|error| format!("FFprobe JSON: {error}"))?;
    let stream = probe
        .streams
        .first()
        .ok_or_else(|| "音声ストリームがありません。".to_owned())?;
    let ext = extension(Path::new(&name)).unwrap_or_default();
    if !matches_format(
        &ext,
        &probe.format.format_name,
        stream.codec_name.as_deref().unwrap_or_default(),
    ) {
        return Err("拡張子と実際の音声形式が一致しないか、非対応のコーデックです。".into());
    }

    let duration_seconds = positive_duration(stream.duration.as_deref())
        .or_else(|| tagged_duration(&stream.tags))
        .or_else(|| positive_duration(probe.format.duration.as_deref()))
        .ok_or_else(|| "再生時間を取得できません。".to_owned())?;
    let sample_rate = stream
        .sample_rate
        .as_deref()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| "サンプリング周波数を取得できません。".to_owned())?;
    let channels = stream
        .channels
        .filter(|value| *value > 0)
        .ok_or_else(|| "チャンネル数を取得できません。".to_owned())?;
    let bit_rate = stream
        .bit_rate
        .as_deref()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .or_else(|| {
            probe
                .format
                .bit_rate
                .as_deref()
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| *value > 0)
        });

    if !(8_000..=48_000).contains(&sample_rate) || !(1..=2).contains(&channels) {
        return Err("音声は 8～48 kHz、モノラルまたはステレオに対応しています。".into());
    }

    Ok(AudioInfo {
        name,
        duration_seconds,
        sample_rate,
        channels,
        bit_rate,
    })
}

pub(crate) fn probe_audio(path: &str) -> Result<AudioInfo, String> {
    probe_audio_inner(path).map_err(|error| errors::tagged("INPUT_AUDIO", error))
}

fn probe_audio_inner(path: &str) -> Result<AudioInfo, String> {
    let input = Path::new(path);
    if !input.is_absolute() || !extension(input).is_some_and(|ext| supported_extension(&ext)) {
        return Err("対応するローカルの音声素材を選択してください。".into());
    }
    let metadata = input
        .metadata()
        .map_err(|error| errors::io_error("音声ファイルを開けません", &error, "INPUT_AUDIO"))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("空または無効なファイルです。".into());
    }
    let name = input
        .file_name()
        .ok_or_else(|| "ファイル名を取得できません。".to_owned())?
        .to_string_lossy()
        .into_owned();

    let output = Tool::Ffprobe.run(&[
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        AUDIO_FORMATS,
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,sample_rate,channels,duration,bit_rate:stream_tags=DURATION:format=format_name,duration,bit_rate",
        "-of",
        "json",
        "-i",
        path,
    ])?;
    parse_info(name, &output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_mp3_metadata() {
        let data = br#"{
            "streams":[{"codec_name":"mp3","sample_rate":"44100",
                        "channels":2,"duration":"181.5","bit_rate":"192000"}],
            "format":{"format_name":"mp3","duration":"181.6"}
        }"#;
        let info = parse_info("song.mp3".into(), data).unwrap();
        assert_eq!(info.name, "song.mp3");
        assert_eq!(info.duration_seconds, 181.5);
        assert_eq!(info.sample_rate, 44_100);
        assert_eq!(info.channels, 2);
        assert_eq!(info.bit_rate, Some(192_000));
    }

    #[test]
    fn uses_container_duration_when_stream_duration_is_unavailable() {
        let data = br#"{
            "streams":[{"codec_name":"mp3","sample_rate":"48000",
                        "channels":1,"duration":"N/A"}],
            "format":{"format_name":"mp3","duration":"42.5","bit_rate":"128000"}
        }"#;
        let info = parse_info("mono.mp3".into(), data).unwrap();
        assert_eq!(info.duration_seconds, 42.5);
        assert_eq!(info.channels, 1);
        assert_eq!(info.bit_rate, Some(128_000));
    }

    #[test]
    fn rejects_other_formats_and_missing_streams() {
        for data in [
            r#"{"streams":[{"codec_name":"aac"}],"format":{"format_name":"aac"}}"#,
            r#"{"streams":[],"format":{"format_name":"mp3"}}"#,
            r#"{"format":{"format_name":"mp3"}}"#,
            "not JSON",
        ] {
            assert!(parse_info("invalid.mp3".into(), data.as_bytes()).is_err());
        }
    }

    #[test]
    fn validates_container_and_codec_pairs() {
        for (ext, format, codec) in [
            ("wav", "wav", "pcm_s16le"),
            ("flac", "flac", "flac"),
            ("aac", "aac", "aac"),
            ("m4a", "mov,mp4,m4a,3gp,3g2,mj2", "aac"),
            ("mp4", "mov,mp4,m4a,3gp,3g2,mj2", "aac"),
            ("webm", "matroska,webm", "opus"),
            ("mov", "mov,mp4,m4a,3gp,3g2,mj2", "aac"),
            ("mkv", "matroska,webm", "aac"),
        ] {
            assert!(matches_format(ext, format, codec));
            assert!(!matches_format("mp3", format, codec));
        }
        assert!(!matches_format("wav", "wav", "aac"));
        assert!(!matches_format("webm", "matroska,webm", "h264"));
    }

    #[test]
    fn prefers_audio_stream_duration_to_container_duration() {
        let data = br#"{"streams":[{"codec_name":"opus","sample_rate":"48000","channels":2,
            "tags":{"DURATION":"00:00:02.500000000"}}],
            "format":{"format_name":"matroska,webm","duration":"8.0"}}"#;
        let info = parse_info("song.webm".into(), data).unwrap();
        assert_eq!(info.duration_seconds, 2.5);
    }

    #[test]
    fn rejects_invalid_duration() {
        for value in ["N/A", "0", "-1", "NaN", "inf"] {
            assert_eq!(positive_duration(Some(value)), None);
        }
    }

    #[test]
    fn rejects_relative_paths_and_unsupported_extensions() {
        assert!(probe_audio("song.mp3").is_err());
        let path = std::env::temp_dir().join("song.txt");
        assert!(probe_audio(path.to_str().unwrap()).is_err());
    }

    #[test]
    fn rejects_missing_empty_and_directory_mp3_paths() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing.mp3");
        let empty = dir.path().join("empty.mp3");
        let folder = dir.path().join("folder.mp3");
        std::fs::write(&empty, []).unwrap();
        std::fs::create_dir(&folder).unwrap();
        for (path, code) in [
            (missing, "[MVM:PATH_MISSING]"),
            (empty, "[MVM:INPUT_AUDIO]"),
            (folder, "[MVM:INPUT_AUDIO]"),
        ] {
            assert!(probe_audio(path.to_str().unwrap())
                .unwrap_err()
                .starts_with(code));
        }
    }
}

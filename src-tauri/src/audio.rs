use crate::ffmpeg::Tool;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioInfo {
    name: String,
    pub(crate) duration_seconds: f64,
    sample_rate: u32,
    channels: u32,
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

fn parse_info(name: String, bytes: &[u8]) -> Result<AudioInfo, String> {
    let probe: ProbeResult =
        serde_json::from_slice(bytes).map_err(|error| format!("FFprobe JSON: {error}"))?;
    let stream = probe
        .streams
        .first()
        .ok_or_else(|| "音声ストリームがありません。".to_owned())?;
    if probe.format.format_name != "mp3" || stream.codec_name.as_deref() != Some("mp3") {
        return Err("MP3 音声ファイルを選択してください。".into());
    }

    let duration_seconds = positive_duration(stream.duration.as_deref())
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

    Ok(AudioInfo {
        name,
        duration_seconds,
        sample_rate,
        channels,
        bit_rate,
    })
}

pub(crate) fn probe_audio(path: &str) -> Result<AudioInfo, String> {
    let input = Path::new(path);
    if !input.is_absolute()
        || !input
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("mp3"))
    {
        return Err("ローカルの MP3 ファイルを選択してください。".into());
    }
    let metadata = input
        .metadata()
        .map_err(|error| format!("ファイルを開けません: {error}"))?;
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
        "mp3",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,sample_rate,channels,duration,bit_rate:format=format_name,duration,bit_rate",
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
    fn rejects_invalid_duration() {
        for value in ["N/A", "0", "-1", "NaN", "inf"] {
            assert_eq!(positive_duration(Some(value)), None);
        }
    }

    #[test]
    fn rejects_relative_paths_and_non_mp3_extensions() {
        assert!(probe_audio("song.mp3").is_err());
        let path = std::env::temp_dir().join("song.wav");
        assert!(probe_audio(path.to_str().unwrap()).is_err());
    }
}

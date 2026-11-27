use serde::Deserialize;

const MAX_FILTERS: usize = 32;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FilterEntry {
    enabled: bool,
    filter: AudioFilter,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum AudioFilter {
    NoiseReduction {
        reduction_db: f64,
        noise_floor_db: f64,
    },
    HighPass {
        frequency_hz: f64,
    },
    LowPass {
        frequency_hz: f64,
    },
    Equalizer {
        frequency_hz: f64,
        q: f64,
        gain_db: f64,
    },
    Gain {
        gain_db: f64,
    },
}

fn bounded(value: f64, min: f64, max: f64, name: &str) -> Result<(), String> {
    if value.is_finite() && (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(format!(
            "{name} は {min} ～ {max} の範囲で指定してください。"
        ))
    }
}

fn frequency(value: f64, sample_rate: u32) -> Result<(), String> {
    bounded(value, 20.0, 20_000.0, "周波数 (Hz)")?;
    if value >= f64::from(sample_rate) / 2.0 {
        return Err("周波数は音声のナイキスト周波数未満にしてください。".into());
    }
    Ok(())
}

impl AudioFilter {
    fn expression(&self, sample_rate: u32) -> Result<String, String> {
        match *self {
            Self::NoiseReduction {
                reduction_db,
                noise_floor_db,
            } => {
                bounded(reduction_db, 0.01, 30.0, "ノイズ低減量 (dB)")?;
                bounded(noise_floor_db, -80.0, -20.0, "ノイズフロア (dB)")?;
                Ok(format!("afftdn=nr={reduction_db}:nf={noise_floor_db}"))
            }
            Self::HighPass { frequency_hz } => {
                frequency(frequency_hz, sample_rate)?;
                Ok(format!("highpass=f={frequency_hz}"))
            }
            Self::LowPass { frequency_hz } => {
                frequency(frequency_hz, sample_rate)?;
                Ok(format!("lowpass=f={frequency_hz}"))
            }
            Self::Equalizer {
                frequency_hz,
                q,
                gain_db,
            } => {
                frequency(frequency_hz, sample_rate)?;
                bounded(q, 0.1, 10.0, "EQ Q")?;
                bounded(gain_db, -24.0, 24.0, "EQ ゲイン (dB)")?;
                Ok(format!("equalizer=f={frequency_hz}:t=q:w={q}:g={gain_db}"))
            }
            Self::Gain { gain_db } => {
                bounded(gain_db, -24.0, 24.0, "ゲイン (dB)")?;
                Ok(format!("volume={gain_db}dB"))
            }
        }
    }
}

// The input list is the processing order. Disabled entries do not affect audio.
pub(crate) fn compile(filters: &[FilterEntry], sample_rate: u32) -> Result<Option<String>, String> {
    if filters.len() > MAX_FILTERS {
        return Err(format!("フィルタは最大 {MAX_FILTERS} 個までです。"));
    }
    if !(8_000..=48_000).contains(&sample_rate) {
        return Err("非対応の MP3 サンプリング周波数です。".into());
    }
    let expressions: Result<Vec<_>, _> = filters
        .iter()
        .filter(|entry| entry.enabled)
        .map(|entry| entry.filter.expression(sample_rate))
        .collect();
    let expressions = expressions?;
    if expressions.is_empty() {
        Ok(None)
    } else {
        Ok(Some(expressions.join(",")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffmpeg::Tool;

    fn gain(enabled: bool, gain_db: f64) -> FilterEntry {
        FilterEntry {
            enabled,
            filter: AudioFilter::Gain { gain_db },
        }
    }

    #[test]
    fn empty_and_disabled_filters_do_not_create_graph() {
        assert_eq!(compile(&[], 44_100).unwrap(), None);
        assert_eq!(compile(&[gain(false, 999.0)], 44_100).unwrap(), None);
    }

    #[test]
    fn enabled_entries_follow_list_order() {
        let filters = [
            gain(true, -3.0),
            gain(false, 4.0),
            FilterEntry {
                enabled: true,
                filter: AudioFilter::HighPass { frequency_hz: 80.0 },
            },
            gain(true, 6.0),
        ];
        let graph = compile(&filters, 44_100).unwrap().unwrap();
        assert_eq!(graph, "volume=-3dB,highpass=f=80,volume=6dB");
    }

    #[test]
    fn validates_values_and_nyquist_frequency() {
        for value in [f64::NAN, f64::INFINITY, -25.0, 25.0] {
            assert!(compile(&[gain(true, value)], 44_100).is_err());
        }
        let lowpass = FilterEntry {
            enabled: true,
            filter: AudioFilter::LowPass {
                frequency_hz: 8_000.0,
            },
        };
        assert!(compile(&[lowpass], 16_000).is_err());
        assert!(compile(&[], 0).is_err());
        let too_many: Vec<_> = (0..33).map(|_| gain(false, 0.0)).collect();
        assert!(compile(&too_many, 44_100).is_err());
    }

    #[test]
    fn accepts_typed_json_but_rejects_raw_graphs() {
        let json = r#"[
            {"enabled":true,"filter":{"kind":"noiseReduction","reductionDb":12,"noiseFloorDb":-50}},
            {"enabled":true,"filter":{"kind":"equalizer","frequencyHz":1000,"q":1,"gainDb":3}}
        ]"#;
        let entries: Vec<FilterEntry> = serde_json::from_str(json).unwrap();
        let graph = compile(&entries, 48_000).unwrap().unwrap();
        assert_eq!(graph, "afftdn=nr=12:nf=-50,equalizer=f=1000:t=q:w=1:g=3");
        let invalid = r#"{"enabled":true,"filter":{"kind":"raw","graph":"volume=10"}}"#;
        assert!(serde_json::from_str::<FilterEntry>(invalid).is_err());
        let injection = r#"{"enabled":true,"filter":{"kind":"gain","gainDb":"1,volume=10"}}"#;
        assert!(serde_json::from_str::<FilterEntry>(injection).is_err());
    }

    fn tone_pcm(frequency_hz: u32, graph: Option<&str>) -> Vec<u8> {
        let source = format!("sine=frequency={frequency_hz}:sample_rate=48000:duration=0.5");
        let mut args = vec![
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            source.as_str(),
        ];
        if let Some(graph) = graph {
            args.extend(["-af", graph]);
        }
        args.extend(["-f", "f32le", "-acodec", "pcm_f32le", "-"]);
        Tool::Ffmpeg.run(&args).unwrap().stdout
    }

    fn pcm(graph: Option<&str>) -> Vec<u8> {
        tone_pcm(1000, graph)
    }

    fn rms(bytes: &[u8]) -> f64 {
        let mut sum = 0.0;
        let mut count = 0;
        let (chunks, remainder) = bytes.as_chunks::<4>();
        assert!(remainder.is_empty());
        for chunk in chunks {
            let sample = f64::from(f32::from_le_bytes(*chunk));
            assert!(sample.is_finite());
            sum += sample * sample;
            count += 1;
        }
        assert!(count > 0);
        (sum / f64::from(count)).sqrt()
    }

    #[test]
    #[ignore = "requires FFmpeg with afftdn and standard audio filters"]
    fn processes_filter_chain() {
        let baseline = pcm(None);
        let disabled = compile(&[gain(false, -6.0)], 48_000).unwrap();
        assert_eq!(pcm(disabled.as_deref()), baseline);
        let graph = compile(&[gain(true, -6.0), gain(true, -6.0)], 48_000).unwrap();
        let processed = pcm(graph.as_deref());
        assert_eq!(processed.len(), baseline.len());
        let ratio = rms(&processed) / rms(&baseline);
        assert!((ratio - 10_f64.powf(-12.0 / 20.0)).abs() < 0.001);

        let json = r#"[
            {"enabled":true,"filter":{"kind":"noiseReduction","reductionDb":12,"noiseFloorDb":-50}},
            {"enabled":true,"filter":{"kind":"highPass","frequencyHz":80}},
            {"enabled":true,"filter":{"kind":"lowPass","frequencyHz":10000}},
            {"enabled":true,"filter":{"kind":"equalizer","frequencyHz":1000,"q":1,"gainDb":3}},
            {"enabled":true,"filter":{"kind":"gain","gainDb":-6}}
        ]"#;
        let entries: Vec<FilterEntry> = serde_json::from_str(json).unwrap();
        let graph = compile(&entries, 48_000).unwrap();
        assert!(rms(&pcm(graph.as_deref())) > 0.0);
    }

    fn noise_graph(reduction_db: f64, noise_floor_db: f64) -> Result<Option<String>, String> {
        let filter = FilterEntry {
            enabled: true,
            filter: AudioFilter::NoiseReduction {
                reduction_db,
                noise_floor_db,
            },
        };
        compile(&[filter], 48_000)
    }

    #[test]
    fn validates_noise_reduction_parameters() {
        let graph = noise_graph(6.0, -50.0).unwrap().unwrap();
        assert_eq!(graph, "afftdn=nr=6:nf=-50");
        for (nr, nf) in [(0.0, -50.0), (31.0, -50.0), (6.0, -81.0), (6.0, -19.0)] {
            assert!(noise_graph(nr, nf).is_err());
        }
        assert!(noise_graph(f64::NAN, -50.0).is_err());
        assert!(noise_graph(6.0, f64::INFINITY).is_err());
    }

    fn noise_pcm(graph: Option<&str>) -> Vec<u8> {
        let mut args = vec![
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anoisesrc=color=white:amplitude=0.01:seed=1234:sample_rate=48000:duration=3",
        ];
        if let Some(graph) = graph {
            args.extend(["-af", graph]);
        }
        args.extend(["-f", "f32le", "-acodec", "pcm_f32le", "-"]);
        Tool::Ffmpeg.run(&args).unwrap().stdout
    }

    fn steady_noise_rms(graph: Option<&str>) -> f64 {
        let samples = noise_pcm(graph);
        assert_eq!(samples.len(), 3 * 48_000 * 4);
        // Measure the middle second after filter startup.
        rms(&samples[48_000 * 4..96_000 * 4])
    }

    #[test]
    #[ignore = "requires FFmpeg with afftdn"]
    fn processes_noise_reduction_parameters() {
        let baseline = steady_noise_rms(None);
        let moderate = noise_graph(6.0, -45.0).unwrap();
        let stronger = noise_graph(12.0, -45.0).unwrap();
        let low_floor = noise_graph(12.0, -60.0).unwrap();
        let moderate = steady_noise_rms(moderate.as_deref());
        let stronger = steady_noise_rms(stronger.as_deref());
        let low_floor = steady_noise_rms(low_floor.as_deref());
        assert!(moderate < baseline * 0.85);
        assert!(stronger < moderate);
        assert!(low_floor > stronger);
    }

    #[test]
    fn validates_frequency_filter_ranges() {
        let json = r#"[
            {"enabled":true,"filter":{"kind":"highPass","frequencyHz":80}},
            {"enabled":true,"filter":{"kind":"lowPass","frequencyHz":12000}},
            {"enabled":true,"filter":{"kind":"equalizer","frequencyHz":1000,"q":1,"gainDb":6}}
        ]"#;
        let entries: Vec<FilterEntry> = serde_json::from_str(json).unwrap();
        assert_eq!(
            compile(&entries, 48_000).unwrap().unwrap(),
            "highpass=f=80,lowpass=f=12000,equalizer=f=1000:t=q:w=1:g=6"
        );
        assert!(compile(&entries, 16_000).is_err());
        for (q, gain_db) in [(0.0, 0.0), (10.1, 0.0), (1.0, 25.0), (1.0, -25.0)] {
            let entry = FilterEntry {
                enabled: true,
                filter: AudioFilter::Equalizer {
                    frequency_hz: 1000.0,
                    q,
                    gain_db,
                },
            };
            assert!(compile(&[entry], 48_000).is_err());
        }
    }

    fn response_db(filter: AudioFilter, frequency_hz: u32) -> f64 {
        let entry = FilterEntry {
            enabled: true,
            filter,
        };
        let graph = compile(&[entry], 48_000).unwrap().unwrap();
        let reference = tone_pcm(frequency_hz, None);
        let processed = tone_pcm(frequency_hz, Some(&graph));
        assert_eq!(reference.len(), processed.len());
        // Discard the first 100 ms to exclude filter startup.
        let start = 4_800 * 4;
        20.0 * (rms(&processed[start..]) / rms(&reference[start..])).log10()
    }

    #[test]
    #[ignore = "requires FFmpeg with highpass, lowpass and equalizer"]
    fn processes_frequency_response() {
        let hp = || AudioFilter::HighPass {
            frequency_hz: 1000.0,
        };
        let lp = || AudioFilter::LowPass {
            frequency_hz: 1000.0,
        };
        let eq = || AudioFilter::Equalizer {
            frequency_hz: 1000.0,
            q: 1.0,
            gain_db: 6.0,
        };
        assert!(response_db(hp(), 100) < -35.0);
        assert!((response_db(hp(), 1000) + 3.0).abs() < 0.25);
        assert!(response_db(hp(), 10_000).abs() < 0.5);
        assert!(response_db(lp(), 100).abs() < 0.5);
        assert!((response_db(lp(), 1000) + 3.0).abs() < 0.25);
        assert!(response_db(lp(), 10_000) < -35.0);
        assert!(response_db(eq(), 100).abs() < 0.5);
        assert!((response_db(eq(), 1000) - 6.0).abs() < 0.25);
        assert!(response_db(eq(), 10_000).abs() < 0.5);
    }
}

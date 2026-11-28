//! Select and verify FFmpeg H.264 encoders without linking GPU SDKs.
use crate::{encode_job::EncodeJob, errors, ffmpeg::Tool};
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::process::Stdio;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Encoder {
    #[default]
    Cpu,
    Auto,
    Nvenc,
    Qsv,
    Amf,
    Videotoolbox,
}

impl Encoder {
    pub(crate) fn codec(self) -> &'static str {
        match self {
            Self::Cpu | Self::Auto => "libx264",
            Self::Nvenc => "h264_nvenc",
            Self::Qsv => "h264_qsv",
            Self::Amf => "h264_amf",
            Self::Videotoolbox => "h264_videotoolbox",
        }
    }

    pub(crate) fn args(self, quality: u32, fps: u32) -> Vec<String> {
        let mut args = vec!["-c:v".into(), self.codec().into()];
        let quality_text = quality.to_string();
        let mut options = match self {
            Self::Cpu | Self::Auto => vec!["-preset", "medium", "-crf", &quality_text],
            Self::Nvenc => vec![
                "-preset",
                "p4",
                "-rc",
                "vbr",
                "-cq",
                &quality_text,
                "-b:v",
                "0",
            ],
            Self::Qsv => vec!["-preset", "medium", "-global_quality", &quality_text],
            Self::Amf => vec![
                "-quality",
                "balanced",
                "-rc",
                "cqp",
                "-qp_i",
                &quality_text,
                "-qp_p",
                &quality_text,
            ],
            Self::Videotoolbox => vec!["-allow_sw", "0"],
        };
        options.extend([
            "-pix_fmt",
            if self == Self::Qsv {
                "nv12"
            } else {
                "yuv420p"
            },
        ]);
        args.extend(options.into_iter().map(str::to_owned));
        if self == Self::Videotoolbox {
            // VideoToolbox uses a bitrate tier, not x264's CRF scale.
            let mbps = match quality {
                16 => 12,
                24 => 5,
                _ => 8,
            };
            args.extend(["-b:v".into(), format!("{}k", mbps * 1000 * fps / 30)]);
        }
        args
    }
}

fn candidates(os: &str) -> &'static [Encoder] {
    match os {
        "windows" => &[Encoder::Nvenc, Encoder::Qsv, Encoder::Amf],
        "linux" => &[Encoder::Nvenc, Encoder::Qsv],
        "macos" => &[Encoder::Videotoolbox],
        _ => &[],
    }
}

#[derive(Clone, Copy)]
pub(crate) struct ProbeSpec {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) fps: u32,
    pub(crate) quality: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncoderCapability {
    encoder: Encoder,
    available: bool,
    reason: Option<String>,
}

pub(crate) fn probe(encoder: Encoder, spec: ProbeSpec, job: Option<&EncodeJob>) -> Result<(), String> {
    if let Some(job) = job {
        job.check_cancelled()?;
    }
    let input = format!(
        "color=c=black:s={}x{}:r={}",
        spec.width, spec.height, spec.fps
    );
    let mut stderr = tempfile::tempfile()
        .map_err(|error| errors::io_error("GPU 診断用一時ファイル", &error, "OUTPUT_IO"))?;
    let stderr_output = stderr.try_clone().map_err(|error| error.to_string())?;
    let mut child = Tool::Ffmpeg
        .command()
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-xerror",
            "-f",
            "lavfi",
            "-i",
            &input,
            "-frames:v",
            "3",
            "-an",
        ])
        .args(encoder.args(spec.quality, spec.fps))
        .args(["-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr_output))
        .spawn()
        .map_err(|error| errors::tool_start_error("FFmpeg", &error))?;
    let deadline = Instant::now() + Duration::from_secs(12);
    let status = loop {
        let stop = job
            .map_or(Ok(()), EncodeJob::check_cancelled)
            .and_then(|()| {
                if Instant::now() >= deadline {
                    Err(errors::tagged(
                        "PROCESS_FAILED",
                        "GPU エンコーダーの検出がタイムアウトしました。",
                    ))
                } else {
                    Ok(())
                }
            });
        if let Err(error) = stop {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(errors::tool_start_error("FFmpeg", &error));
            }
        }
    };
    if status.success() {
        return Ok(());
    }
    stderr
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut detail = Vec::new();
    stderr
        .take(4096)
        .read_to_end(&mut detail)
        .map_err(|error| error.to_string())?;
    Err(errors::process_error(encoder.codec(), status, &detail))
}

pub(crate) fn detect() -> Vec<EncoderCapability> {
    let spec = ProbeSpec {
        width: 1920,
        height: 1080,
        fps: 30,
        quality: 20,
    };
    candidates(std::env::consts::OS)
        .iter()
        .map(|&encoder| {
            let result = probe(encoder, spec, None);
            EncoderCapability {
                encoder,
                available: result.is_ok(),
                reason: result.err(),
            }
        })
        .collect()
}

fn choose(
    requested: Encoder,
    supported: &[Encoder],
    mut check: impl FnMut(Encoder) -> Result<(), String>,
) -> Result<(Encoder, Option<String>), String> {
    if requested == Encoder::Cpu {
        return Ok((Encoder::Cpu, None));
    }
    let choices = if requested == Encoder::Auto {
        supported
    } else if supported.contains(&requested) {
        std::slice::from_ref(&requested)
    } else {
        return Ok((
            Encoder::Cpu,
            Some(format!("{} はこの OS の対象外です。", requested.codec())),
        ));
    };
    let mut reasons = Vec::new();
    for &encoder in choices {
        match check(encoder) {
            Ok(()) => return Ok((encoder, None)),
            Err(error) if error == crate::encode_job::CANCELLED => return Err(error),
            Err(error) => reasons.push(format!(
                "{}: {}",
                encoder.codec(),
                error.chars().take(500).collect::<String>()
            )),
        }
    }
    let detail = if reasons.is_empty() {
        "この OS の対応 GPU エンコーダーはありません。".into()
    } else {
        reasons.join("\n")
    };
    Ok((Encoder::Cpu, Some(detail)))
}

pub(crate) fn select(
    requested: Encoder,
    spec: ProbeSpec,
    job: &EncodeJob,
) -> Result<(Encoder, Option<String>), String> {
    choose(requested, candidates(std::env::consts::OS), |encoder| {
        probe(encoder, spec, Some(job))
    })
}

fn retryable(error: &str) -> bool {
    [
        "[MVM:PROCESS_FAILED]",
        "[MVM:TOOL_FEATURE]",
        "[MVM:OUTPUT_VERIFY]",
    ]
    .iter()
    .any(|prefix| error.starts_with(prefix))
}

// Retry only failed hardware processing/verification, not cancellation,
// disk/permission failures or invalid input. Publishing stays outside this helper.
pub(crate) fn with_fallback<T>(
    selected: Encoder,
    reason: Option<String>,
    job: &EncodeJob,
    mut attempt: impl FnMut(Encoder, bool) -> Result<T, String>,
) -> Result<(T, Encoder, Option<String>), String> {
    job.check_cancelled()?;
    match attempt(selected, reason.is_some()) {
        Ok(value) => Ok((value, selected, reason)),
        Err(error) if selected != Encoder::Cpu && retryable(&error) => {
            job.check_cancelled()?;
            let reason = format!("{}: {error}", selected.codec());
            match attempt(Encoder::Cpu, true) {
                Ok(value) => Ok((value, Encoder::Cpu, Some(reason))),
                Err(cpu) if cpu == crate::encode_job::CANCELLED => Err(cpu),
                Err(cpu) => Err(format!("{cpu}\nGPU: {reason}")),
            }
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_only_supported_working_encoders() {
        let list = candidates("windows");
        let chosen = choose(Encoder::Auto, list, |e| {
            if e == Encoder::Qsv {
                Ok(())
            } else {
                Err("no device".into())
            }
        })
        .unwrap();
        assert_eq!(chosen, (Encoder::Qsv, None));
        let result = choose(Encoder::Nvenc, list, |_| Err("no driver".into())).unwrap();
        assert_eq!(result.0, Encoder::Cpu);
        assert!(result.1.unwrap().contains("no driver"));
        assert_eq!(
            choose(Encoder::Cpu, list, |_| panic!("CPU must not probe")).unwrap(),
            (Encoder::Cpu, None)
        );
        assert_eq!(
            choose(Encoder::Auto, list, |_| Err(crate::encode_job::CANCELLED.into()))
                .unwrap_err(),
            crate::encode_job::CANCELLED
        );
        assert!(choose(Encoder::Amf, candidates("macos"), |_| panic!("unsupported"))
            .unwrap()
            .1
            .is_some());
    }

    #[test]
    fn encoder_options_are_backend_specific() {
        for encoder in [
            Encoder::Cpu,
            Encoder::Nvenc,
            Encoder::Qsv,
            Encoder::Amf,
            Encoder::Videotoolbox,
        ] {
            let args = encoder.args(20, 60);
            assert!(args.windows(2).any(|pair| pair == ["-c:v", encoder.codec()]));
            assert_eq!(
                args.iter().any(|arg| arg == "-crf"),
                encoder == Encoder::Cpu
            );
        }
        assert!(Encoder::Videotoolbox
            .args(20, 60)
            .windows(2)
            .any(|pair| pair == ["-b:v", "16000k"]));
        assert!(Encoder::Qsv
            .args(20, 30)
            .windows(2)
            .any(|pair| pair == ["-pix_fmt", "nv12"]));
    }

    #[test]
    fn retries_gpu_once_but_never_retries_cancel_or_io_failure() {
        let job = EncodeJob::default();
        let mut calls = Vec::new();
        let result = with_fallback(Encoder::Nvenc, None, &job, |encoder, fallback| {
            calls.push((encoder, fallback));
            if encoder == Encoder::Cpu {
                Ok(42)
            } else {
                Err("[MVM:OUTPUT_VERIFY] invalid".into())
            }
        })
        .unwrap();
        assert_eq!(calls, [(Encoder::Nvenc, false), (Encoder::Cpu, true)]);
        assert_eq!(result.0, 42);
        assert_eq!(result.1, Encoder::Cpu);
        assert!(result.2.unwrap().contains("invalid"));
        for error in [
            crate::encode_job::CANCELLED,
            "[MVM:DISK_FULL] full",
            "[MVM:PERMISSION] denied",
        ] {
            let mut count = 0;
            let result = with_fallback::<()>(Encoder::Nvenc, None, &job, |_, _| {
                count += 1;
                Err(error.into())
            });
            assert_eq!(result.unwrap_err(), error);
            assert_eq!(count, 1);
        }
    }

    #[test]
    #[ignore = "requires FFmpeg; GPU availability is optional"]
    fn probes_cpu_and_reports_gpu_capabilities_without_requiring_hardware() {
        let spec = ProbeSpec {
            width: 1920,
            height: 1080,
            fps: 30,
            quality: 20,
        };
        probe(Encoder::Cpu, spec, None).unwrap();
        for capability in detect() {
            assert_ne!(capability.encoder, Encoder::Cpu);
            assert_eq!(capability.available, capability.reason.is_none());
        }
    }
}

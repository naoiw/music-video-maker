use serde::Serialize;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::process::Stdio;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use crate::ffmpeg::Tool;

pub(crate) const CANCELLED: &str = "ENCODE_CANCELLED";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
    Preparing,
    Encoding,
    Verifying,
    Saving,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    pub(crate) phase: Phase,
    pub(crate) duration_seconds: f64,
    pub(crate) processed_seconds: f64,
    pub(crate) cancelled: bool,
}

pub(crate) struct EncodeJob {
    state: Mutex<Progress>,
}

impl Default for EncodeJob {
    fn default() -> Self {
        Self {
            state: Mutex::new(Progress {
                phase: Phase::Preparing,
                duration_seconds: 0.0,
                processed_seconds: 0.0,
                cancelled: false,
            }),
        }
    }
}

impl EncodeJob {
    fn state(&self) -> MutexGuard<'_, Progress> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }

    pub(crate) fn snapshot(&self) -> Progress {
        *self.state()
    }

    pub(crate) fn request_cancel(&self) -> bool {
        let mut state = self.state();
        if state.phase == Phase::Saving {
            return false;
        }
        state.cancelled = true;
        true
    }

    pub(crate) fn check_cancelled(&self) -> Result<(), String> {
        if self.snapshot().cancelled {
            Err(CANCELLED.into())
        } else {
            Ok(())
        }
    }

    pub(crate) fn set_duration(&self, duration_seconds: f64) {
        self.state().duration_seconds = duration_seconds;
    }

    pub(crate) fn set_phase(&self, phase: Phase) {
        self.state().phase = phase;
    }

    fn update_time(&self, seconds: f64) {
        let mut state = self.state();
        state.processed_seconds = state.processed_seconds.max(seconds);
    }

    // Cancellation and publishing are mutually exclusive.
    pub(crate) fn begin_saving(&self) -> Result<(), String> {
        let mut state = self.state();
        if state.cancelled {
            return Err(CANCELLED.into());
        }
        state.phase = Phase::Saving;
        Ok(())
    }
}

static ACTIVE: Mutex<Option<(u32, Arc<EncodeJob>)>> = Mutex::new(None);

pub(crate) struct ActiveJob {
    job: Arc<EncodeJob>,
}

impl ActiveJob {
    pub(crate) fn register(id: u32) -> Result<Self, String> {
        let mut active = ACTIVE.lock().map_err(|error| error.to_string())?;
        if active.is_some() {
            return Err("別の動画生成を実行中です。".into());
        }
        let job = Arc::new(EncodeJob::default());
        *active = Some((id, Arc::clone(&job)));
        Ok(Self { job })
    }

    pub(crate) fn job(&self) -> &EncodeJob {
        &self.job
    }
}

impl Drop for ActiveJob {
    fn drop(&mut self) {
        let mut active = ACTIVE.lock().unwrap_or_else(|error| error.into_inner());
        *active = None;
    }
}

fn find_job(id: u32) -> Option<Arc<EncodeJob>> {
    let active = ACTIVE.lock().ok()?;
    let (active_id, job) = active.as_ref()?;
    (*active_id == id).then(|| Arc::clone(job))
}

pub(crate) fn progress(id: u32) -> Option<Progress> {
    find_job(id).map(|job| job.snapshot())
}

pub(crate) fn cancel(id: u32) -> bool {
    find_job(id).is_some_and(|job| job.request_cancel())
}

fn parse_progress_time(line: &str) -> Option<f64> {
    let micros = line.strip_prefix("out_time_us=")?.parse::<i64>().ok()?;
    Some(micros.max(0) as f64 / 1_000_000.0)
}

pub(crate) fn run_ffmpeg(args: &[&str], job: &EncodeJob) -> Result<(), String> {
    job.check_cancelled()?;
    // Store stderr separately so a full pipe cannot block FFmpeg or cancellation.
    let mut stderr = tempfile::tempfile().map_err(|error| error.to_string())?;
    let stderr_output = stderr.try_clone().map_err(|error| error.to_string())?;
    let mut child = Tool::Ffmpeg
        .command()
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(stderr_output))
        .spawn()
        .map_err(|error| format!("FFmpeg: {error}"))?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("FFmpeg の進捗を取得できません。".into());
    };
    job.set_phase(Phase::Encoding);

    let result = thread::scope(|scope| {
        let reader = scope.spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(seconds) = parse_progress_time(&line) {
                    job.update_time(seconds);
                }
            }
        });

        let status = loop {
            if job.check_cancelled().is_err() {
                let _ = child.kill();
                let _ = child.wait();
                break Err(CANCELLED.to_owned());
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(format!("FFmpeg: {error}"));
                }
            }
        };
        reader
            .join()
            .map_err(|_| "FFmpeg の進捗読み取りに失敗しました。".to_owned())?;
        status
    })?;

    job.check_cancelled()?;
    if !result.success() {
        stderr
            .seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        let mut detail = Vec::new();
        stderr
            .take(65536)
            .read_to_end(&mut detail)
            .map_err(|error| error.to_string())?;
        return Err(format!(
            "FFmpeg exited with {result}: {}",
            String::from_utf8_lossy(&detail).trim()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ffmpeg_progress() {
        assert_eq!(parse_progress_time("out_time_us=1500000"), Some(1.5));
        assert_eq!(parse_progress_time("out_time_us=-500"), Some(0.0));
        assert_eq!(parse_progress_time("out_time_us=N/A"), None);
        assert_eq!(parse_progress_time("progress=end"), None);
    }

    #[test]
    fn progress_is_monotonic_and_saving_cannot_be_cancelled() {
        let job = EncodeJob::default();
        job.set_duration(10.0);
        job.update_time(3.0);
        job.update_time(2.0);
        assert_eq!(job.snapshot().processed_seconds, 3.0);
        assert_eq!(job.snapshot().duration_seconds, 10.0);
        job.begin_saving().unwrap();
        assert!(!job.request_cancel());
        assert!(job.check_cancelled().is_ok());
    }

    #[test]
    fn cancellation_prevents_publishing_and_registry_releases() {
        let active = ActiveJob::register(123).unwrap();
        assert!(ActiveJob::register(124).is_err());
        assert!(!cancel(124));
        assert!(cancel(123));
        assert!(progress(123).unwrap().cancelled);
        assert_eq!(active.job().begin_saving().unwrap_err(), CANCELLED);
        drop(active);
        assert!(progress(123).is_none());
        assert!(ActiveJob::register(124).is_ok());
    }
}

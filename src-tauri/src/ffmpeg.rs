use std::path::PathBuf;
use std::process::{Command, Output};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Clone, Copy)]
pub enum Tool {
    Ffmpeg,
    Ffprobe,
}

impl Tool {
    fn name(self) -> &'static str {
        match self {
            Self::Ffmpeg => "ffmpeg",
            Self::Ffprobe => "ffprobe",
        }
    }

    fn executable(self) -> PathBuf {
        let name = format!("{}{}", self.name(), std::env::consts::EXE_SUFFIX);
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let bundled = dir.join(&name);
                if bundled.is_file() {
                    return bundled;
                }
            }
        }
        PathBuf::from(name)
    }

    pub fn command(self) -> Command {
        let mut command = Command::new(self.executable());
        #[cfg(windows)]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        command
    }

    pub fn run(self, args: &[&str]) -> Result<Output, String> {
        let output = self
            .command()
            .args(args)
            .output()
            .map_err(|error| format!("{}: {error}", self.name()))?;
        if output.status.success() {
            Ok(output)
        } else {
            Err(format!(
                "{} exited with {}: {}",
                self.name(),
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    }

    pub fn version(self) -> Result<String, String> {
        let output = self.run(&["-version"])?;
        first_line(&output.stdout).ok_or_else(|| format!("{}: empty version output", self.name()))
    }
}

fn first_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_version_line() {
        assert_eq!(
            first_line(b"\nffmpeg version test\nconfiguration: test"),
            Some("ffmpeg version test".into())
        );
        assert_eq!(first_line(b" \n"), None);
    }

    #[test]
    fn selects_expected_tool_names() {
        assert_eq!(Tool::Ffmpeg.name(), "ffmpeg");
        assert_eq!(Tool::Ffprobe.name(), "ffprobe");
    }
}

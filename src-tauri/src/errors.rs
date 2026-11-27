use std::fmt::Display;
use std::io::{self, ErrorKind};

const MAX_DETAIL_CHARS: usize = 8192;

pub(crate) fn tagged(code: &str, detail: impl Display) -> String {
    let detail = detail.to_string();
    if detail.starts_with("[MVM:") || detail == crate::encode_job::CANCELLED {
        return detail;
    }
    let mut chars = detail.chars();
    let mut bounded: String = chars.by_ref().take(MAX_DETAIL_CHARS).collect();
    if chars.next().is_some() {
        bounded.push_str("… (truncated)");
    }
    format!("[MVM:{code}] {bounded}")
}

pub(crate) fn io_error(context: &str, error: &io::Error, fallback: &str) -> String {
    let code = match error.kind() {
        ErrorKind::PermissionDenied => "PERMISSION",
        ErrorKind::StorageFull => "DISK_FULL",
        ErrorKind::NotFound => "PATH_MISSING",
        ErrorKind::AlreadyExists => "OUTPUT_EXISTS",
        _ => fallback,
    };
    #[cfg(windows)]
    let code = if matches!(error.raw_os_error(), Some(32 | 33)) {
        "FILE_BUSY"
    } else {
        code
    };
    tagged(code, format!("{context}: {error}"))
}

pub(crate) fn tool_start_error(tool: &str, error: &io::Error) -> String {
    if error.kind() == ErrorKind::NotFound {
        tagged("TOOL_MISSING", format!("{tool}: {error}"))
    } else {
        io_error(tool, error, "TOOL_START")
    }
}

pub(crate) fn process_error(tool: &str, status: impl Display, stderr: &[u8]) -> String {
    let detail = String::from_utf8_lossy(stderr);
    let lower = detail.to_ascii_lowercase();
    let code = if lower.contains("no space left on device")
        || lower.contains("disk full")
        || lower.contains("not enough space")
        || lower.contains("insufficient disk space")
    {
        "DISK_FULL"
    } else if lower.contains("permission denied")
        || lower.contains("access is denied")
        || lower.contains("operation not permitted")
    {
        "PERMISSION"
    } else if lower.contains("no such file or directory") {
        "PATH_MISSING"
    } else if lower.contains("unknown encoder") || lower.contains("no such filter") {
        "TOOL_FEATURE"
    } else if lower.contains("invalid data found") || lower.contains("error while decoding") {
        "INVALID_MEDIA"
    } else {
        "PROCESS_FAILED"
    };
    tagged(
        code,
        format!("{tool} exited with {status}: {}", detail.trim()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_io_errors_without_language_dependent_messages() {
        for (kind, code) in [
            (ErrorKind::PermissionDenied, "PERMISSION"),
            (ErrorKind::StorageFull, "DISK_FULL"),
            (ErrorKind::NotFound, "PATH_MISSING"),
            (ErrorKind::AlreadyExists, "OUTPUT_EXISTS"),
            (ErrorKind::Other, "IO"),
        ] {
            let error = io::Error::from(kind);
            assert!(io_error("test", &error, "IO").starts_with(&format!("[MVM:{code}]")));
        }
        assert!(tool_start_error("ffmpeg", &io::Error::from(ErrorKind::NotFound))
            .starts_with("[MVM:TOOL_MISSING]"));
    }

    #[test]
    fn classifies_process_failures_and_preserves_detail() {
        for (detail, code) in [
            ("No space left on device", "DISK_FULL"),
            ("Permission denied", "PERMISSION"),
            ("No such file or directory", "PATH_MISSING"),
            ("Unknown encoder 'libx264'", "TOOL_FEATURE"),
            ("Invalid data found when processing input", "INVALID_MEDIA"),
            ("unexpected error", "PROCESS_FAILED"),
        ] {
            let error = process_error("ffmpeg", 1, detail.as_bytes());
            assert!(error.starts_with(&format!("[MVM:{code}]")));
            assert!(error.contains(detail));
        }
    }

    #[test]
    fn preserves_specific_codes_and_cancellation_and_bounds_unicode() {
        let error = tagged("DISK_FULL", "detail");
        assert_eq!(tagged("OUTPUT_IO", &error), error);
        assert_eq!(
            tagged("PROCESS_FAILED", crate::encode_job::CANCELLED),
            crate::encode_job::CANCELLED
        );
        let detail = "あ".repeat(MAX_DETAIL_CHARS + 1);
        assert!(tagged("IO", detail).ends_with("… (truncated)"));
    }
}

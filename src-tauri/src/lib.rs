mod ffmpeg;

use serde::Serialize;

#[derive(Serialize)]
struct RuntimeInfo {
    os: &'static str,
    version: &'static str,
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        os: std::env::consts::OS,
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[derive(Serialize)]
struct ToolStatus {
    version: Option<String>,
    error: Option<String>,
}

fn tool_status(tool: ffmpeg::Tool) -> ToolStatus {
    match tool.version() {
        Ok(version) => ToolStatus {
            version: Some(version),
            error: None,
        },
        Err(error) => ToolStatus {
            version: None,
            error: Some(error),
        },
    }
}

#[derive(Serialize)]
struct MediaToolStatus {
    ffmpeg: ToolStatus,
    ffprobe: ToolStatus,
}

#[tauri::command]
async fn media_tool_status() -> Result<MediaToolStatus, String> {
    tauri::async_runtime::spawn_blocking(|| MediaToolStatus {
        ffmpeg: tool_status(ffmpeg::Tool::Ffmpeg),
        ffprobe: tool_status(ffmpeg::Tool::Ffprobe),
    })
    .await
    .map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![runtime_info, media_tool_status])
        .run(tauri::generate_context!())
        .expect("failed to run Music Video Maker");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_info_matches_package() {
        let info = runtime_info();
        assert_eq!(info.os, std::env::consts::OS);
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }
}

mod audio;
mod ffmpeg;
mod video;
mod visual;

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

#[tauri::command]
async fn probe_audio(path: String) -> Result<audio::AudioInfo, String> {
    tauri::async_runtime::spawn_blocking(move || audio::probe_audio(&path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_visual(path: String) -> Result<visual::VisualInfo, String> {
    tauri::async_runtime::spawn_blocking(move || visual::load_visual(&path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn encode_video(
    audio_path: String,
    visual_path: String,
    output_path: String,
    settings: video::OutputSettings,
) -> Result<video::VideoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        video::encode_video(&audio_path, &visual_path, &output_path, settings)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            media_tool_status,
            probe_audio,
            load_visual,
            encode_video
        ])
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

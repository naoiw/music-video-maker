mod audio;
mod audio_filters;
mod audio_preview;
mod encode_job;
mod ffmpeg;
mod settings;
mod video;
mod visual;

use serde::Serialize;
use tauri::Manager;

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
fn compile_audio_filters(
    filters: Vec<audio_filters::FilterEntry>,
    sample_rate: u32,
) -> Result<Option<String>, String> {
    audio_filters::compile(&filters, sample_rate)
}

#[tauri::command]
async fn render_audio_preview(
    path: String,
    start_seconds: f64,
    filters: Vec<audio_filters::FilterEntry>,
) -> Result<audio_preview::AudioPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        audio_preview::render(&path, start_seconds, &filters)
    })
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
    filters: Vec<audio_filters::FilterEntry>,
    job_id: u32,
) -> Result<video::VideoInfo, String> {
    let active = encode_job::ActiveJob::register(job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = video::encode_video(
            &audio_path,
            &visual_path,
            &output_path,
            settings,
            &filters,
            active.job(),
        );
        active.job().check_cancelled()?;
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn encode_progress(job_id: u32) -> Option<encode_job::Progress> {
    encode_job::progress(job_id)
}

#[tauri::command]
fn cancel_encode(job_id: u32) -> bool {
    encode_job::cancel(job_id)
}

#[tauri::command]
fn read_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    settings::read(&dir)
}

#[tauri::command]
fn write_settings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    settings::write(&dir, &json)
}

#[tauri::command]
fn read_presets(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    settings::read_presets(&dir)
}

#[tauri::command]
fn write_presets(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    settings::write_presets(&dir, &json)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            media_tool_status,
            probe_audio,
            compile_audio_filters,
            render_audio_preview,
            load_visual,
            encode_video,
            encode_progress,
            cancel_encode,
            read_settings,
            write_settings,
            read_presets,
            write_presets
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

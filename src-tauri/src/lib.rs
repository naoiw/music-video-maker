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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![runtime_info])
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

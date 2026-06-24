mod download_manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Test command: spawns an external mpv process with the given URL.
/// Used to verify that external mpv playback works on Linux (Docker/X11)
/// without touching the embedded tauri-plugin-libmpv path.
#[tauri::command]
async fn test_mpv(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new("mpv");
    cmd.arg("--fullscreen")
       .arg("--vo=gpu")
       .arg("--hwdec=no");

    if let Some(ref hdrs) = headers {
        let fields: Vec<String> = hdrs
            .iter()
            .filter(|(k, _)| k.to_lowercase() != "user-agent")
            .map(|(k, v)| format!("{}: {}", k, v))
            .collect();
        if !fields.is_empty() {
            cmd.arg(format!("--http-header-fields={}", fields.join(",")));
        }
        let ua = hdrs.get("user-agent").or_else(|| hdrs.get("User-Agent"));
        if let Some(ua) = ua {
            cmd.arg(format!("--user-agent={}", ua));
        }
    }

    cmd.arg(&url);
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_upload::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_window_state::Builder::new().build())
            .plugin(tauri_plugin_libmpv::init());
    }

    builder
        .manage(download_manager::DownloadState::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            test_mpv,
            download_manager::start_download,
            download_manager::pause_download,
            download_manager::cancel_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

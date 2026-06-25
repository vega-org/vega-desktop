mod cookie_manager;
mod download_manager;
mod external_mpv;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
            external_mpv::launch_mpv,
            download_manager::start_download,
            download_manager::pause_download,
            download_manager::cancel_download,
            cookie_manager::get_cookies_for_url,
            cookie_manager::clear_cookies_for_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

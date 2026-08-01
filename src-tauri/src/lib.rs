mod cookie_manager;
mod download_manager;
mod stream_server;
mod doh_client;
mod torrent;
mod sync_manifest;

use std::sync::Mutex;
use tauri::Manager;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_window_state::StateFlags;
#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, HWND_TOPMOST,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, WS_MAXIMIZE,
    },
};

struct ProxyState {
    port: Mutex<Option<u16>>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_stream_proxy_port(state: tauri::State<'_, ProxyState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

#[tauri::command]
fn get_torrent_api_port(state: tauri::State<'_, Option<torrent::TorrentState>>) -> Result<u16, String> {
    if let Some(ref torrent_state) = *state {
        Ok(torrent_state.api_port)
    } else {
        Err("Torrent service is not available".into())
    }
}

#[tauri::command]
fn open_external_player(_url: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if std::process::Command::new("mpv")
            .arg("--player-operation-mode=pseudo-gui")
            .arg("--fs")
            .arg("--osc")
            .arg(&_url)
            .spawn().is_ok() {
            return Ok(());
        }
        if std::process::Command::new("vlc")
            .arg("--fullscreen")
            .arg(&_url)
            .spawn().is_ok() {
            return Ok(());
        }
        if std::process::Command::new("xdg-open").arg(&_url).spawn().is_ok() {
            return Ok(());
        }
        return Err("Failed to launch external player".into());
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("Not supported on this OS".into())
    }
}

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = window;
    }
}

#[tauri::command]
fn set_player_fullscreen(window: tauri::WebviewWindow, fullscreen: bool) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        #[cfg(target_os = "windows")]
        let was_maximized = window.is_maximized().map_err(|error| error.to_string())?;
        window
            .set_fullscreen(fullscreen)
            .map_err(|error| error.to_string())?;

        #[cfg(target_os = "windows")]
        if fullscreen && was_maximized {
            let hwnd_value = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
            window
                .run_on_main_thread(move || unsafe {
                    let hwnd = HWND(hwnd_value as _);
                    let style = GetWindowLongPtrW(hwnd, GWL_STYLE);

                    // Clear only the native maximized bit without calling
                    // SW_RESTORE, which would visibly shrink the window first.
                    SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(WS_MAXIMIZE.0 as isize));

                    let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                    let mut monitor_info = MONITORINFO {
                        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                        ..Default::default()
                    };

                    if GetMonitorInfoW(monitor, &mut monitor_info).as_bool() {
                        let bounds = monitor_info.rcMonitor;
                        let _ = SetWindowPos(
                            hwnd,
                            Some(HWND_TOPMOST),
                            bounds.left,
                            bounds.top,
                            bounds.right - bounds.left,
                            bounds.bottom - bounds.top,
                            SWP_FRAMECHANGED | SWP_NOACTIVATE,
                        );
                    }
                })
                .map_err(|error| error.to_string())?;
        }
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = (window, fullscreen);

    Ok(())
}

#[tauri::command]
fn ensure_window_in_work_area(window: tauri::WebviewWindow, maximized: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd_value = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        window
            .run_on_main_thread(move || unsafe {
                let hwnd = HWND(hwnd_value as _);
                let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                let mut monitor_info = MONITORINFO {
                    cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };
                let mut window_rect = RECT::default();

                if !GetMonitorInfoW(monitor, &mut monitor_info).as_bool()
                    || GetWindowRect(hwnd, &mut window_rect).is_err()
                {
                    return;
                }

                let work = monitor_info.rcWork;
                let work_width = work.right - work.left;
                let work_height = work.bottom - work.top;
                let (x, y, width, height) = if maximized {
                    (work.left, work.top, work_width, work_height)
                } else {
                    let width = (window_rect.right - window_rect.left)
                        .min(work_width)
                        .max(1);
                    let height = (window_rect.bottom - window_rect.top)
                        .min(work_height)
                        .max(1);
                    let x = window_rect
                        .left
                        .clamp(work.left, work.right.saturating_sub(width));
                    let y = window_rect
                        .top
                        .clamp(work.top, work.bottom.saturating_sub(height));
                    (x, y, width, height)
                };

                let _ = SetWindowPos(
                    hwnd,
                    None,
                    x,
                    y,
                    width,
                    height,
                    SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER,
                );
            })
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    let _ = (window, maximized);

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_upload::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::DECORATIONS)
                .build(),
        )
        .plugin(tauri_plugin_libmpv::init());

    builder
        .manage(ProxyState { port: Mutex::new(None) })
        .manage(download_manager::DownloadState::new())
        .setup(|app| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                println!("[stream_proxy] Starting proxy server...");
                match stream_server::start_server().await {
                    Ok(port) => {
                        println!("[stream_proxy] Server started on port {}", port);
                        let state: tauri::State<ProxyState> = app_handle.state();
                        *state.port.lock().unwrap() = Some(port);
                    }
                    Err(e) => {
                        eprintln!("[stream_proxy] Failed to start server: {}", e);
                    }
                }
            });

            let torrent_cache_dir = app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir()).join("vega-torrents");
            let torrent_state = tauri::async_runtime::block_on(async {
                match torrent::TorrentState::new(torrent_cache_dir).await {
                    Ok(state) => Some(state),
                    Err(e) => {
                        eprintln!("[torrent] Failed to initialize torrent engine: {}", e);
                        None
                    }
                }
            });
            app.manage(torrent_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_stream_proxy_port,
            get_torrent_api_port,
            download_manager::start_download,
            download_manager::pause_download,
            download_manager::cancel_download,
            download_manager::save_subtitle,
            cookie_manager::get_cookies_for_url,
            cookie_manager::clear_cookies_for_url,
            open_external_player,
            toggle_devtools,
            set_player_fullscreen,
            ensure_window_in_work_area,
            doh_client::doh_fetch,
            sync_manifest::read_sync_manifests,
            sync_manifest::write_sync_manifest,
            sync_manifest::resolve_sync_media_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

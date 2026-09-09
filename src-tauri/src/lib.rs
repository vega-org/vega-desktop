mod cookie_manager;
mod doh_client;
mod download_manager;
mod ffmpeg_resolver;
mod media_probe;
mod stream_server;
mod sync_manifest;
mod torrent;

use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
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
    local_files: stream_server::LocalFileRegistry,
}

static NEXT_LOCAL_FILE_TOKEN: AtomicU64 = AtomicU64::new(1);

#[cfg(not(any(target_os = "android", target_os = "ios")))]
static THUMBNAIL_GENERATION_LOCK: Mutex<()> = Mutex::new(());

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_stream_proxy_port(state: tauri::State<'_, ProxyState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

#[tauri::command]
fn get_local_stream_url(
    state: tauri::State<'_, ProxyState>,
    base_dir: String,
    file_path: String,
) -> Result<String, String> {
    let path = download_manager::validate_download_path(&base_dir, &file_path)?;
    if !path.is_file() {
        return Err("Downloaded media file does not exist".into());
    }
    let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    let port = state
        .port
        .lock()
        .map_err(|_| "Stream proxy is unavailable".to_string())?
        .ok_or_else(|| "Stream proxy has not started".to_string())?;
    let token = NEXT_LOCAL_FILE_TOKEN
        .fetch_add(1, Ordering::Relaxed)
        .to_string();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("media")
        .to_string();
    let mut files = state
        .local_files
        .lock()
        .map_err(|_| "Stream proxy is unavailable".to_string())?;
    files.clear();
    files.insert(token.clone(), path);
    Ok(format!(
        "http://127.0.0.1:{port}/local/{token}/{}",
        urlencoding::encode(&file_name)
    ))
}

#[tauri::command]
fn get_torrent_api_port(
    state: tauri::State<'_, Option<torrent::TorrentState>>,
) -> Result<u16, String> {
    if let Some(ref torrent_state) = *state {
        Ok(torrent_state.api_port)
    } else {
        Err("Torrent service is not available".into())
    }
}

#[tauri::command]
async fn probe_media_info(
    _app: tauri::AppHandle,
    source: String,
    headers: Option<HashMap<String, String>>,
) -> Result<media_probe::MediaProbeResult, String> {
    media_probe::probe_media(&source, headers).await
}

#[tauri::command]
async fn extract_subtitles(
    app: tauri::AppHandle,
    source: String,
    track_index: u32,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    media_probe::extract_subtitles_to_string(Some(app), &source, track_index, headers).await
}

#[tauri::command]
async fn extract_subtitle_window(
    source: String,
    track_index: u32,
    start_time: f64,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    media_probe::extract_subtitle_window(&source, track_index, start_time, headers).await
}

#[tauri::command]
async fn get_seek_keyframe(
    _app: tauri::AppHandle,
    source: String,
    target_time: f64,
    headers: Option<HashMap<String, String>>,
) -> Result<f64, String> {
    media_probe::find_seek_keyframe(&source, target_time, headers)
        .await
        .ok_or_else(|| "Keyframe not found".to_string())
}

/// Decodes a single frame in an isolated MPV core. This deliberately does not
/// seek the visible player, so hovering and dragging the timeline cannot
/// interrupt playback.
#[tauri::command]
async fn generate_video_thumbnail(
    app: tauri::AppHandle,
    source: String,
    timestamp: f64,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, source, timestamp, headers);
        return Err("Video thumbnails are only available in the desktop app".into());
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;

        let safe_timestamp = if timestamp.is_finite() {
            timestamp.max(0.0)
        } else {
            0.0
        };
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        source.hash(&mut hasher);
        ((safe_timestamp * 1000.0).round() as u64).hash(&mut hasher);
        if let Some(values) = headers.as_ref() {
            let mut entries: Vec<_> = values.iter().collect();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            for (name, value) in entries {
                name.to_ascii_lowercase().hash(&mut hasher);
                value.hash(&mut hasher);
            }
        }
        let cache_key = format!("{:016x}", hasher.finish());
        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("seek-thumbnails");
        std::fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
        let cache_file = cache_dir.join(format!("{cache_key}.jpg"));

        let encode_file = |path: &std::path::Path| -> Result<String, String> {
            let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
            Ok(format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ))
        };
        if cache_file
            .metadata()
            .map(|meta| meta.len() > 0)
            .unwrap_or(false)
        {
            return encode_file(&cache_file);
        }

        let _generation_guard = THUMBNAIL_GENERATION_LOCK
            .lock()
            .map_err(|_| "Thumbnail generator is unavailable".to_string())?;

        if cache_file
            .metadata()
            .map(|meta| meta.len() > 0)
            .unwrap_or(false)
        {
            return encode_file(&cache_file);
        }

        let clean_source = ffmpeg_resolver::clean_source(&source);

        let ffmpeg_path = ffmpeg_resolver::get_ffmpeg_path()?;
        let temp_file = cache_dir.join(format!("tmp-{cache_key}-{}.jpg", std::process::id()));
        if temp_file.exists() {
            let _ = std::fs::remove_file(&temp_file);
        }

        let is_network = clean_source.starts_with("http://") || clean_source.starts_with("https://");
        let mut cmd = std::process::Command::new(&ffmpeg_path);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        if let Some(parent) = ffmpeg_path.parent().filter(|p| !p.as_os_str().is_empty()) {
            cmd.current_dir(parent);
            ffmpeg_resolver::prepend_to_path_env(&mut cmd, parent);
        }

        cmd.arg("-v").arg("error");
        cmd.arg("-nostdin");

        if is_network {
            cmd.arg("-reconnect")
                .arg("1")
                .arg("-reconnect_at_eof")
                .arg("1")
                .arg("-reconnect_streamed")
                .arg("1")
                .arg("-reconnect_delay_max")
                .arg("5");
            cmd.arg("-rw_timeout").arg("5000000");
        }

        cmd.arg("-analyzeduration").arg("3000000");
        cmd.arg("-probesize").arg("3000000");

        if let Some(ref h) = headers {
            let mut lines = Vec::new();
            for (k, v) in h {
                if !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                    let sanitized = v.replace('\r', "").replace('\n', "");
                    lines.push(format!("{}: {}", k, sanitized));
                }
            }
            if !lines.is_empty() {
                lines.push(String::new());
                cmd.arg("-headers").arg(lines.join("\r\n"));
            }
        }

        cmd.arg("-ss").arg(format!("{safe_timestamp:.3}"));
        cmd.arg("-i").arg(&clean_source);
        cmd.arg("-frames:v").arg("1");
        cmd.arg("-an");
        cmd.arg("-sn");
        cmd.arg("-vf").arg("scale=320:-2");
        cmd.arg("-q:v").arg("3");
        cmd.arg("-f").arg("image2");
        cmd.arg("-update").arg("1");
        cmd.arg("-y").arg(&temp_file);

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(6);
        let mut finished = false;
        while start.elapsed() < timeout {
            match child.try_wait() {
                Ok(Some(s)) => {
                    finished = s.success();
                    break;
                }
                Ok(None) => {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(e) => {
                    let _ = child.kill();
                    return Err(format!("Error waiting for ffmpeg: {e}"));
                }
            }
        }

        if !finished {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&temp_file);

            // Fallback: retry with output seeking in case container doesn't support fast input seek
            let mut fallback_cmd = std::process::Command::new(&ffmpeg_path);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                fallback_cmd.creation_flags(0x08000000);
            }
            if let Some(parent) = ffmpeg_path.parent().filter(|p| !p.as_os_str().is_empty()) {
                fallback_cmd.current_dir(parent);
                ffmpeg_resolver::prepend_to_path_env(&mut fallback_cmd, parent);
            }
            fallback_cmd.arg("-v").arg("error").arg("-nostdin");
            if is_network {
                fallback_cmd.arg("-reconnect").arg("1").arg("-reconnect_delay_max").arg("5");
                fallback_cmd.arg("-rw_timeout").arg("5000000");
            }
            fallback_cmd.arg("-analyzeduration").arg("3000000");
            fallback_cmd.arg("-probesize").arg("3000000");
            if let Some(ref h) = headers {
                let mut lines = Vec::new();
                for (k, v) in h {
                    if !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                        let sanitized = v.replace('\r', "").replace('\n', "");
                        lines.push(format!("{}: {}", k, sanitized));
                    }
                }
                if !lines.is_empty() {
                    lines.push(String::new());
                    fallback_cmd.arg("-headers").arg(lines.join("\r\n"));
                }
            }
            fallback_cmd.arg("-i").arg(&clean_source);
            fallback_cmd.arg("-ss").arg(format!("{safe_timestamp:.3}"));
            fallback_cmd.arg("-frames:v").arg("1");
            fallback_cmd.arg("-an").arg("-sn");
            fallback_cmd.arg("-vf").arg("scale=320:-2");
            fallback_cmd.arg("-q:v").arg("3");
            fallback_cmd.arg("-f").arg("image2");
            fallback_cmd.arg("-update").arg("1");
            fallback_cmd.arg("-y").arg(&temp_file);

            if let Ok(mut fb_child) = fallback_cmd.spawn() {
                let fb_start = std::time::Instant::now();
                let fb_timeout = std::time::Duration::from_secs(6);
                while fb_start.elapsed() < fb_timeout {
                    match fb_child.try_wait() {
                        Ok(Some(s)) => {
                            finished = s.success();
                            break;
                        }
                        Ok(None) => std::thread::sleep(std::time::Duration::from_millis(25)),
                        Err(_) => {
                            let _ = fb_child.kill();
                            break;
                        }
                    }
                }
                if !finished {
                    let _ = fb_child.kill();
                    let _ = fb_child.wait();
                }
            }
        }

        if (!temp_file.exists() || temp_file.metadata().map(|m| m.len() == 0).unwrap_or(true)) && safe_timestamp > 2.0 {
            let mut start_cmd = std::process::Command::new(&ffmpeg_path);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                start_cmd.creation_flags(0x08000000);
            }
            if let Some(parent) = ffmpeg_path.parent().filter(|p| !p.as_os_str().is_empty()) {
                start_cmd.current_dir(parent);
                ffmpeg_resolver::prepend_to_path_env(&mut start_cmd, parent);
            }
            start_cmd.arg("-v").arg("error").arg("-nostdin");
            start_cmd.arg("-ss").arg("1.000");
            start_cmd.arg("-i").arg(&clean_source);
            start_cmd.arg("-frames:v").arg("1");
            start_cmd.arg("-an").arg("-sn");
            start_cmd.arg("-vf").arg("scale=320:-2");
            start_cmd.arg("-q:v").arg("3");
            start_cmd.arg("-f").arg("image2");
            start_cmd.arg("-update").arg("1");
            start_cmd.arg("-y").arg(&temp_file);
            if let Ok(mut c) = start_cmd.spawn() {
                let _ = c.wait();
            }
        }

        if !temp_file.exists() || temp_file.metadata().map(|m| m.len() == 0).unwrap_or(true) {
            let _ = std::fs::remove_file(&temp_file);
            return Err("FFmpeg did not produce a valid thumbnail".to_string());
        }

        let _ = std::fs::rename(&temp_file, &cache_file)
            .or_else(|_| std::fs::copy(&temp_file, &cache_file).map(|_| ()));
        let _ = std::fs::remove_file(&temp_file);

        // Keep the persistent preview cache bounded.
        if let Ok(entries) = std::fs::read_dir(&cache_dir) {
            let mut files: Vec<_> = entries
                .filter_map(Result::ok)
                .filter_map(|entry| {
                    let path = entry.path();
                    let modified = entry.metadata().ok()?.modified().ok()?;
                    (path.extension().and_then(|value| value.to_str()) == Some("jpg"))
                        .then_some((modified, path))
                })
                .collect();
            if files.len() > 240 {
                files.sort_by_key(|(modified, _)| *modified);
                let remove_count = files.len() - 200;
                for (_, path) in files.into_iter().take(remove_count) {
                    let _ = std::fs::remove_file(path);
                }
            }
        }

        encode_file(&cache_file)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_external_player(
    url: String,
    player_path: Option<String>,
    headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let default_path = if cfg!(target_os = "windows") {
        r"C:\Program Files\VideoLAN\VLC\vlc.exe"
    } else if cfg!(target_os = "macos") {
        "/Applications/VLC.app/Contents/MacOS/VLC"
    } else {
        "/usr/bin/vlc"
    };
    let path = player_path
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_path.to_string());
    if !std::path::Path::new(&path).is_file() {
        return Err(format!(
            "VLC was not found at '{}'. Change its path in Settings.",
            path
        ));
    }

    let mut command = std::process::Command::new(&path);
    command.arg("--fullscreen");
    if let Some(headers) = headers {
        for (name, value) in headers {
            match name.to_ascii_lowercase().as_str() {
                "user-agent" => {
                    command.arg(format!("--http-user-agent={value}"));
                }
                "referer" | "referrer" => {
                    command.arg(format!("--http-referrer={value}"));
                }
                _ => {}
            }
        }
    }
    let local_path = std::path::Path::new(&url);
    if local_path.is_absolute() {
        if !local_path.is_file() {
            return Err(format!(
                "The downloaded media file does not exist: '{}'",
                local_path.display()
            ));
        }
        let canonical_path = std::fs::canonicalize(local_path)
            .map_err(|error| format!("Failed to resolve local media path: {error}"))?;
        command.arg(canonical_path);
    } else {
        command.arg(url);
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to launch VLC: {error}"))
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
    let local_files = Arc::new(Mutex::new(HashMap::new()));
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
        );


    builder
        .manage(ProxyState {
            port: Mutex::new(None),
            local_files: local_files.clone(),
        })
        .manage(download_manager::DownloadState::new())
        .setup(|app| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }

            let app_handle = app.handle().clone();
            let app_handle_for_server = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                println!("[stream_proxy] Starting proxy server...");
                match stream_server::start_server(local_files, Some(app_handle_for_server)).await {
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

            let torrent_cache_dir = app
                .path()
                .app_cache_dir()
                .unwrap_or_else(|_| std::env::temp_dir())
                .join("vega-torrents");
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
            get_local_stream_url,
            generate_video_thumbnail,
            get_torrent_api_port,
            download_manager::start_download,
            download_manager::pause_download,
            download_manager::cancel_download,
            download_manager::save_subtitle,
            download_manager::list_download_subtitles,
            cookie_manager::get_cookies_for_url,
            cookie_manager::clear_cookies_for_url,
            open_external_player,
            toggle_devtools,
            set_player_fullscreen,
            ensure_window_in_work_area,
            doh_client::doh_fetch,
            sync_manifest::read_sync_manifests,
            sync_manifest::write_sync_manifest,
            sync_manifest::resolve_sync_media_path,
            probe_media_info,
            extract_subtitles,
            extract_subtitle_window,
            get_seek_keyframe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

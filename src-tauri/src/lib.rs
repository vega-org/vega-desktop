mod cookie_manager;
mod doh_client;
mod download_manager;
mod stream_server;
mod sync_manifest;
mod torrent;

#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
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
use windows::core::PCWSTR;
#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    System::LibraryLoader::SetDllDirectoryW,
    UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, HWND_TOPMOST,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, WS_MAXIMIZE,
    },
};

#[cfg(target_os = "windows")]
fn configure_bundled_dll_search_path() {
    let Some(lib_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("lib")))
        .filter(|path| path.is_dir())
    else {
        return;
    };

    let wide_path: Vec<u16> = lib_dir
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    if let Err(error) = unsafe { SetDllDirectoryW(PCWSTR(wide_path.as_ptr())) } {
        eprintln!(
            "[libmpv] Failed to add bundled library directory '{}': {}",
            lib_dir.display(),
            error
        );
    }
}

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
        use tauri_plugin_libmpv::MpvExt;

        let _generation_guard = THUMBNAIL_GENERATION_LOCK
            .lock()
            .map_err(|_| "Thumbnail generator is unavailable".to_string())?;

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

        let output_dir = cache_dir.join(format!("work-{cache_key}"));
        if output_dir.exists() {
            let _ = std::fs::remove_dir_all(&output_dir);
        }
        std::fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

        let instance_label = format!("thumbnail-{cache_key}");
        let mut initial_options = serde_json::Map::new();
        initial_options.insert("wid".into(), serde_json::json!(0));
        initial_options.insert("idle".into(), serde_json::json!("yes"));
        initial_options.insert("audio".into(), serde_json::json!("no"));
        initial_options.insert("sub".into(), serde_json::json!("no"));
        initial_options.insert("osd-level".into(), serde_json::json!("0"));
        initial_options.insert("really-quiet".into(), serde_json::json!("yes"));
        initial_options.insert("vo".into(), serde_json::json!("image"));
        initial_options.insert("vo-image-format".into(), serde_json::json!("jpg"));
        initial_options.insert("vo-image-jpeg-quality".into(), serde_json::json!("72"));
        initial_options.insert("vf".into(), serde_json::json!("scale=320:-2"));
        initial_options.insert(
            "vo-image-outdir".into(),
            serde_json::json!(output_dir.to_string_lossy().to_string()),
        );
        initial_options.insert("frames".into(), serde_json::json!("1"));
        initial_options.insert(
            "start".into(),
            serde_json::json!(format!("{safe_timestamp:.3}")),
        );

        if let Some(values) = headers.as_ref() {
            let mut header_fields = Vec::new();
            for (name, value) in values {
                match name.to_ascii_lowercase().as_str() {
                    "user-agent" => {
                        initial_options.insert("user-agent".into(), serde_json::json!(value));
                    }
                    "referer" | "referrer" => {
                        initial_options.insert("referrer".into(), serde_json::json!(value));
                    }
                    _ => {}
                }
                header_fields.push(format!("{name}: {value}"));
            }
            if !header_fields.is_empty() {
                initial_options.insert(
                    "http-header-fields".into(),
                    serde_json::json!(header_fields.join(",")),
                );
            }
        }

        let config: tauri_plugin_libmpv::MpvConfig = serde_json::from_value(serde_json::json!({
            "initialOptions": initial_options,
            "observedProperties": {}
        }))
        .map_err(|error| error.to_string())?;

        app.mpv()
            .init(config, &instance_label)
            .map_err(|error| format!("Failed to start thumbnail decoder: {error}"))?;
        let load_result = app.mpv().command(
            "loadfile",
            &vec![serde_json::json!(source), serde_json::json!("replace")],
            &instance_label,
        );
        if let Err(error) = load_result {
            let _ = app.mpv().destroy(&instance_label);
            let _ = std::fs::remove_dir_all(&output_dir);
            return Err(format!("Failed to decode thumbnail: {error}"));
        }

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut generated_file = None;
        while std::time::Instant::now() < deadline {
            if let Ok(entries) = std::fs::read_dir(&output_dir) {
                generated_file = entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .find(|path| {
                        path.extension()
                            .and_then(|value| value.to_str())
                            .map(|value| value.eq_ignore_ascii_case("jpg"))
                            .unwrap_or(false)
                            && path.metadata().map(|meta| meta.len() > 0).unwrap_or(false)
                    });
            }
            if generated_file.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(40));
        }
        let _ = app.mpv().destroy(&instance_label);

        let generated_file = generated_file.ok_or_else(|| {
            let _ = std::fs::remove_dir_all(&output_dir);
            "MPV did not produce a thumbnail in time".to_string()
        })?;
        std::thread::sleep(std::time::Duration::from_millis(25));
        std::fs::rename(&generated_file, &cache_file)
            .or_else(|_| std::fs::copy(&generated_file, &cache_file).map(|_| ()))
            .map_err(|error| error.to_string())?;
        let _ = std::fs::remove_dir_all(&output_dir);

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

#[tauri::command]
fn diagnose_mpv_initialization(
    window: tauri::WebviewWindow,
    mut initial_options: HashMap<String, serde_json::Value>,
) -> String {
    #[cfg(target_os = "windows")]
    {
        use libloading::Library;
        use std::ffi::{c_char, c_int, c_void, CStr, CString};
        use std::os::windows::ffi::OsStrExt;
        use std::path::Path;
        use windows::{
            core::PCWSTR,
            Win32::{
                Foundation::{GetLastError, SetLastError, WIN32_ERROR},
                System::LibraryLoader::LoadLibraryW,
            },
        };

        #[repr(C)]
        struct RtlOsVersionInfoW {
            size: u32,
            major: u32,
            minor: u32,
            build: u32,
            platform_id: u32,
            service_pack: [u16; 128],
        }

        #[link(name = "ntdll")]
        unsafe extern "system" {
            fn RtlGetVersion(version: *mut RtlOsVersionInfoW) -> i32;
        }

        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetCurrentPackageFullName(length: *mut u32, name: *mut u16) -> i32;
        }

        type MpvCreate = unsafe extern "C" fn() -> *mut c_void;
        type MpvCreateClient = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void;
        type MpvSetOptionString =
            unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
        type MpvInitialize = unsafe extern "C" fn(*mut c_void) -> c_int;
        type MpvErrorString = unsafe extern "C" fn(c_int) -> *const c_char;
        type MpvDestroy = unsafe extern "C" fn(*mut c_void);
        type MpvTerminateDestroy = unsafe extern "C" fn(*mut c_void);

        fn windows_version() -> String {
            let mut version = RtlOsVersionInfoW {
                size: std::mem::size_of::<RtlOsVersionInfoW>() as u32,
                major: 0,
                minor: 0,
                build: 0,
                platform_id: 0,
                service_pack: [0; 128],
            };
            if unsafe { RtlGetVersion(&mut version) } == 0 {
                format!("{}.{}.{}", version.major, version.minor, version.build)
            } else {
                "unavailable".to_string()
            }
        }

        fn package_identity() -> String {
            const ERROR_INSUFFICIENT_BUFFER: i32 = 122;
            const APPMODEL_ERROR_NO_PACKAGE: i32 = 15700;
            let mut length = 0u32;
            let status = unsafe { GetCurrentPackageFullName(&mut length, std::ptr::null_mut()) };
            if status == APPMODEL_ERROR_NO_PACKAGE {
                return "NSIS or unpackaged".to_string();
            }
            if status != ERROR_INSUFFICIENT_BUFFER || length == 0 {
                return format!("unknown (Windows status {status})");
            }

            let mut buffer = vec![0u16; length as usize];
            let status = unsafe { GetCurrentPackageFullName(&mut length, buffer.as_mut_ptr()) };
            if status != 0 {
                return format!("MSIX identity unavailable (Windows status {status})");
            }
            let end = buffer
                .iter()
                .position(|value| *value == 0)
                .unwrap_or(buffer.len());
            format!("MSIX ({})", String::from_utf16_lossy(&buffer[..end]))
        }

        fn error_text(error_string: MpvErrorString, code: c_int) -> String {
            let value = unsafe { error_string(code) };
            if value.is_null() {
                format!("native error code {code}")
            } else {
                unsafe { CStr::from_ptr(value) }
                    .to_string_lossy()
                    .into_owned()
            }
        }

        // `libloading` formats its own error and does not retain GetLastError.
        // Probe with LoadLibraryW on failure so support reports the actual
        // Win32 loader code (126, 193, 577, 1114, etc.).
        fn loader_error(path: &Path) -> Option<u32> {
            let wide_path: Vec<u16> = path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            unsafe { SetLastError(WIN32_ERROR(0)) };
            match unsafe { LoadLibraryW(PCWSTR(wide_path.as_ptr())) } {
                // This diagnostic path is only reached after the real loader
                // failed. Keeping this probe handle until process exit is
                // harmless and avoids relying on an API not enabled by every
                // version of the `windows` crate used in CI.
                Ok(_) => None,
                Err(_) => Some(unsafe { GetLastError().0 }),
            }
        }

        fn loader_error_details(path: &Path) -> String {
            let Some(code) = loader_error(path) else {
                return "Windows loader probe unexpectedly succeeded after libloading failed."
                    .to_string();
            };

            let category = match code {
                126 => "ERROR_MOD_NOT_FOUND: libmpv or one of its dependent DLLs is missing",
                193 => "ERROR_BAD_EXE_FORMAT: architecture mismatch or an invalid DLL",
                577 => "ERROR_INVALID_IMAGE_HASH: the DLL was blocked by signature or policy",
                1114 => "ERROR_DLL_INIT_FAILED: a DLL dependency failed during initialization",
                1157 => "ERROR_DLL_NOT_FOUND: a required dependent DLL is missing",
                _ => "See the Windows system message below",
            };
            let system_message = std::io::Error::from_raw_os_error(code as i32);
            format!("Windows loader error: {code} ({category})\nWindows message: {system_message}")
        }

        let app_version = window.app_handle().package_info().version.to_string();
        let process_architecture = std::env::consts::ARCH;
        let os_architecture = std::env::var("PROCESSOR_ARCHITEW6432")
            .or_else(|_| std::env::var("PROCESSOR_ARCHITECTURE"))
            .unwrap_or_else(|_| "unavailable".to_string());
        let cpu =
            std::env::var("PROCESSOR_IDENTIFIER").unwrap_or_else(|_| "unavailable".to_string());
        let hardware_acceleration = if initial_options.contains_key("hwdec") {
            "enabled"
        } else {
            "disabled"
        };
        let system_details = format!(
            "System details:\nVega: {app_version}\nWindows: {}\nProcess architecture: {process_architecture}\nOS architecture: {os_architecture}\nCPU: {cpu}\nInstallation: {}\nHardware acceleration: {hardware_acceleration}",
            windows_version(),
            package_identity(),
        );
        let report = |detail: String| format!("{detail}\n\n{system_details}");

        macro_rules! finish {
            ($($arg:tt)*) => {
                return report(format!($($arg)*))
            };
        }

        let exe_dir = match std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        {
            Some(path) => path,
            None => finish!("Could not resolve Vega's installation directory."),
        };
        let candidates = [
            exe_dir.join("lib").join("libmpv-2.dll"),
            exe_dir.join("libmpv-2.dll"),
        ];
        let Some(lib_path) = candidates.iter().find(|path| path.is_file()) else {
            finish!(
                "Bundled libmpv-2.dll was not found. Checked: {}",
                candidates
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        };

        let mpv_size = std::fs::metadata(lib_path).map(|value| value.len()).ok();
        let wrapper_path = lib_path.with_file_name("libmpv-wrapper.dll");
        let wrapper_size = std::fs::metadata(&wrapper_path)
            .map(|value| value.len())
            .ok();
        let library_details = format!(
            "Bundled libraries:\nlibmpv-2.dll: {}\nlibmpv-wrapper.dll: {}",
            mpv_size
                .map(|size| format!("present ({size} bytes)"))
                .unwrap_or_else(|| "missing".to_string()),
            wrapper_size
                .map(|size| format!("present ({size} bytes)"))
                .unwrap_or_else(|| "missing".to_string()),
        );
        let report = |detail: String| format!("{detail}\n\n{system_details}\n\n{library_details}");

        let library = match unsafe { Library::new(lib_path) } {
            Ok(library) => library,
            Err(error) => {
                return report(format!(
                    "Windows could not load bundled libmpv-2.dll from '{}': {error}.\n{}",
                    lib_path.display(),
                    loader_error_details(lib_path),
                ));
            }
        };

        macro_rules! load_symbol {
            ($name:literal, $type:ty) => {
                match unsafe { library.get::<$type>(concat!($name, "\0").as_bytes()) } {
                    Ok(symbol) => *symbol,
                    Err(error) => {
                        return report(format!(
                            "Bundled libmpv-2.dll is missing required symbol '{}': {error}",
                            $name
                        ))
                    }
                }
            };
        }

        let mpv_create = load_symbol!("mpv_create", MpvCreate);
        let mpv_create_client = load_symbol!("mpv_create_client", MpvCreateClient);
        let mpv_set_option_string = load_symbol!("mpv_set_option_string", MpvSetOptionString);
        let mpv_initialize = load_symbol!("mpv_initialize", MpvInitialize);
        let mpv_error_string = load_symbol!("mpv_error_string", MpvErrorString);
        let mpv_destroy = load_symbol!("mpv_destroy", MpvDestroy);
        let mpv_terminate_destroy = load_symbol!("mpv_terminate_destroy", MpvTerminateDestroy);

        let handle = unsafe { mpv_create() };
        if handle.is_null() {
            return report("libmpv loaded, but mpv_create() returned null (usually an allocation or broken-runtime failure).".to_string());
        }

        let client_name = CString::new("vega-diagnostic").expect("static string is valid");
        let client = unsafe { mpv_create_client(handle, client_name.as_ptr()) };
        if client.is_null() {
            unsafe { mpv_terminate_destroy(handle) };
            return report(
                "mpv_create_client() returned null after the main MPV handle was created."
                    .to_string(),
            );
        }

        if let Ok(hwnd) = window.hwnd() {
            initial_options.insert(
                "wid".to_string(),
                serde_json::Value::String((hwnd.0 as isize).to_string()),
            );
        }

        for (name, value) in initial_options {
            let value = match value {
                serde_json::Value::Bool(value) => if value { "yes" } else { "no" }.to_string(),
                serde_json::Value::Number(value) => value.to_string(),
                serde_json::Value::String(value) => value,
                _ => continue,
            };
            let Ok(c_name) = CString::new(name.as_str()) else {
                unsafe {
                    mpv_destroy(client);
                    mpv_terminate_destroy(handle);
                }
                return report(format!(
                    "MPV option name contains an invalid null byte: {name:?}"
                ));
            };
            let Ok(c_value) = CString::new(value.as_str()) else {
                unsafe {
                    mpv_destroy(client);
                    mpv_terminate_destroy(handle);
                }
                return report(format!(
                    "MPV option '{name}' contains an invalid null byte."
                ));
            };
            let result =
                unsafe { mpv_set_option_string(handle, c_name.as_ptr(), c_value.as_ptr()) };
            if result < 0 {
                let detail = error_text(mpv_error_string, result);
                unsafe {
                    mpv_destroy(client);
                    mpv_terminate_destroy(handle);
                }
                return report(format!(
                    "MPV rejected option '{name}={value}': {detail} ({result})."
                ));
            }
        }

        let result = unsafe { mpv_initialize(handle) };
        if result < 0 {
            let detail = error_text(mpv_error_string, result);
            unsafe {
                mpv_destroy(client);
                mpv_terminate_destroy(handle);
            }
            return report(format!("mpv_initialize() failed: {detail} ({result})."));
        }

        unsafe {
            mpv_destroy(client);
            mpv_terminate_destroy(handle);
        }
        report("Direct libmpv initialization succeeded. The failure is inside the bundled libmpv wrapper integration rather than MPV or its system dependencies.".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, initial_options);
        "Detailed MPV initialization diagnostics are currently available on Windows only."
            .to_string()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    configure_bundled_dll_search_path();

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
        )
        .plugin(tauri_plugin_libmpv::init());

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
            tauri::async_runtime::spawn(async move {
                println!("[stream_proxy] Starting proxy server...");
                match stream_server::start_server(local_files).await {
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
            diagnose_mpv_initialization,
            doh_client::doh_fetch,
            sync_manifest::read_sync_manifests,
            sync_manifest::write_sync_manifest,
            sync_manifest::resolve_sync_media_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

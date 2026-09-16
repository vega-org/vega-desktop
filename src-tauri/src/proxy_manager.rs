use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::process::Stdio;
use tauri::Manager;
use tokio::sync::RwLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyType {
    None,
    ByeDpi,
    Warp,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProxyStatus {
    pub proxy_type: ProxyType,
    pub is_running: bool,
    pub port: Option<u16>,
    pub error: Option<String>,
}

pub struct ActiveProxyState {
    pub active_type: ProxyType,
    pub port: Option<u16>,
    pub proxy_url: Option<String>,
    pub child: Option<tokio::process::Child>,
    pub pid: Option<u32>,
}

lazy_static! {
    pub static ref GLOBAL_PROXY_STATE: Arc<RwLock<ActiveProxyState>> =
        Arc::new(RwLock::new(ActiveProxyState {
            active_type: ProxyType::None,
            port: None,
            proxy_url: None,
            child: None,
            pid: None,
        }));
}

pub async fn get_active_proxy_url() -> Option<String> {
    let state = GLOBAL_PROXY_STATE.read().await;
    state.proxy_url.clone()
}

pub fn find_available_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?
        .port();
    drop(listener);
    Ok(port)
}

pub async fn wait_for_port_ready(port: u16, max_duration: Duration) -> bool {
    let start = std::time::Instant::now();
    let addr = format!("127.0.0.1:{}", port);
    while start.elapsed() < max_duration {
        if tokio::net::TcpStream::connect(&addr).await.is_ok() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn find_file_recursive(dir: &Path, target_name: &str, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 || !dir.is_dir() {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.eq_ignore_ascii_case(target_name) {
                    return Some(path);
                }
            }
        } else if path.is_dir() {
            subdirs.push(path);
        }
    }
    for subdir in subdirs {
        if let Some(found) = find_file_recursive(&subdir, target_name, max_depth - 1) {
            return Some(found);
        }
    }
    None
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn find_file_prefix_recursive(dir: &Path, prefix: &str, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 || !dir.is_dir() {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let name_lower = name.to_lowercase();
                if name_lower.starts_with(&prefix.to_lowercase())
                    && !name_lower.ends_with(".zip")
                    && !name_lower.ends_with(".tar.gz")
                    && !name_lower.ends_with(".md")
                    && !name_lower.ends_with(".txt")
                {
                    return Some(path);
                }
            }
        } else if path.is_dir() {
            subdirs.push(path);
        }
    }
    for subdir in subdirs {
        if let Some(found) = find_file_prefix_recursive(&subdir, prefix, max_depth - 1) {
            return Some(found);
        }
    }
    None
}

fn get_proxy_data_dir() -> PathBuf {
    if let Ok(app_data) = std::env::var("APPDATA") {
        let dir = Path::new(&app_data).join("vega").join("proxies");
        let _ = std::fs::create_dir_all(&dir);
        return dir;
    }
    if let Ok(home) = std::env::var("HOME") {
        let dir = Path::new(&home).join(".vega").join("proxies");
        let _ = std::fs::create_dir_all(&dir);
        return dir;
    }
    let dir = std::env::temp_dir().join("vega-proxies");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn resolve_proxy_binary(
    app: Option<&tauri::AppHandle>,
    folder_name: &str,
    base_name: &str,
) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let exe_name = format!("{}.exe", base_name);
    #[cfg(not(target_os = "windows"))]
    let exe_name = base_name.to_string();

    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    // Check user's app data proxy directory first
    let data_dir = get_proxy_data_dir();
    candidate_dirs.push(data_dir.join(folder_name));
    candidate_dirs.push(data_dir.clone());

    // Check official Tauri resource directory
    if let Some(handle) = app {
        if let Ok(res_dir) = handle.path().resource_dir() {
            candidate_dirs.push(res_dir.join(folder_name));
            candidate_dirs.push(res_dir.join("resources").join(folder_name));
            candidate_dirs.push(res_dir.join("resources").join("resources").join(folder_name));
            candidate_dirs.push(res_dir.join("src-tauri").join("resources").join(folder_name));
            candidate_dirs.push(res_dir.clone());
        }
        if let Ok(app_data) = handle.path().app_data_dir() {
            candidate_dirs.push(app_data.join("proxies").join(folder_name));
            candidate_dirs.push(app_data.join("proxies"));
        }
    }

    // Check current_exe parent hierarchies
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidate_dirs.push(parent.join("resources").join(folder_name));
            candidate_dirs.push(parent.join("resources").join("resources").join(folder_name));
            candidate_dirs.push(parent.join("resources").join("src-tauri").join("resources").join(folder_name));
            candidate_dirs.push(parent.join(folder_name));
            candidate_dirs.push(parent.to_path_buf());

            if let Some(contents) = parent.parent() {
                candidate_dirs.push(contents.join("Resources").join(folder_name));
                candidate_dirs.push(contents.join("Resources").join("resources").join(folder_name));
                candidate_dirs.push(contents.join("resources").join(folder_name));
                candidate_dirs.push(contents.join("resources").join("resources").join(folder_name));
                candidate_dirs.push(contents.join(folder_name));
                candidate_dirs.push(contents.to_path_buf());
            }
            if let Some(target_dir) = parent.parent() {
                if let Some(src_tauri_dir) = target_dir.parent() {
                    candidate_dirs.push(src_tauri_dir.join("resources").join(folder_name));
                }
            }
        }
    }

    // Check current working directory
    if let Ok(cwd) = std::env::current_dir() {
        candidate_dirs.push(cwd.join("src-tauri").join("resources").join(folder_name));
        candidate_dirs.push(cwd.join("resources").join(folder_name));
        candidate_dirs.push(cwd.join(folder_name));
        candidate_dirs.push(cwd);
    }

    // Direct check in candidate dirs
    for dir in &candidate_dirs {
        let candidate = dir.join(&exe_name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    // Recursive search up to 4 levels in candidate dirs
    for dir in &candidate_dirs {
        if let Some(found) = find_file_recursive(dir, &exe_name, 4) {
            return Ok(found);
        }
    }

    // System PATH
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(&exe_name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Err(format!(
        "Could not find {} executable in candidate locations",
        exe_name
    ))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn resolve_proxy_binary(
    _app: Option<&tauri::AppHandle>,
    _folder_name: &str,
    _base_name: &str,
) -> Result<PathBuf, String> {
    Err("Proxy manager is not supported on mobile platforms".to_string())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn download_proxy_binary(_folder_name: &str, _base_name: &str) -> Result<PathBuf, String> {
    Err("Proxy manager is not supported on mobile platforms".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn download_proxy_binary(folder_name: &str, base_name: &str) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let exe_name = format!("{}.exe", base_name);
    #[cfg(not(target_os = "windows"))]
    let exe_name = base_name.to_string();

    let target_dir = get_proxy_data_dir().join(folder_name);
    let _ = std::fs::create_dir_all(&target_dir);
    let target_file = target_dir.join(&exe_name);

    if target_file.is_file() {
        return Ok(target_file);
    }

    println!(
        "[proxy_manager] Binary {} not found locally. Auto-downloading...",
        exe_name
    );

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build download client: {}", e))?;

    let (download_url, is_zip) = if base_name == "ciadpi" {
        #[cfg(target_os = "windows")]
        {
            (
                "https://github.com/hufrea/byedpi/releases/download/v0.17.3/byedpi-17.3-x86_64-w64.zip",
                true,
            )
        }
        #[cfg(target_os = "linux")]
        {
            #[cfg(target_arch = "aarch64")]
            {
                (
                    "https://github.com/hufrea/byedpi/releases/download/v0.17.3/byedpi-17.3-aarch64.tar.gz",
                    false,
                )
            }
            #[cfg(not(target_arch = "aarch64"))]
            {
                (
                    "https://github.com/hufrea/byedpi/releases/download/v0.17.3/byedpi-17.3-x86_64.tar.gz",
                    false,
                )
            }
        }
        #[cfg(target_os = "macos")]
        {
            return Err("ByeDPI prebuilt binary is not available for macOS".to_string());
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
        {
            return Err("Unsupported OS for ByeDPI binary".to_string());
        }
    } else {
        #[cfg(target_os = "windows")]
        {
            (
                "https://github.com/Diniboy1123/usque/releases/download/v4.2.1/usque_4.2.1_windows_amd64.zip",
                true,
            )
        }
        #[cfg(target_os = "linux")]
        {
            #[cfg(target_arch = "aarch64")]
            {
                (
                    "https://github.com/Diniboy1123/usque/releases/download/v4.2.1/usque_4.2.1_linux_arm64.zip",
                    true,
                )
            }
            #[cfg(not(target_arch = "aarch64"))]
            {
                (
                    "https://github.com/Diniboy1123/usque/releases/download/v4.2.1/usque_4.2.1_linux_amd64.zip",
                    true,
                )
            }
        }
        #[cfg(target_os = "macos")]
        {
            #[cfg(target_arch = "aarch64")]
            {
                (
                    "https://github.com/Diniboy1123/usque/releases/download/v4.2.1/usque_4.2.1_darwin_arm64.zip",
                    true,
                )
            }
            #[cfg(not(target_arch = "aarch64"))]
            {
                (
                    "https://github.com/Diniboy1123/usque/releases/download/v4.2.1/usque_4.2.1_darwin_amd64.zip",
                    true,
                )
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
        {
            return Err("Unsupported OS for WARP binary".to_string());
        }
    };

    println!("[proxy_manager] Fetching from {}", download_url);
    let response = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("Download request failed for {}: {}", download_url, e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with HTTP status: {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download stream: {}", e))?;

    let temp_dir = std::env::temp_dir().join(format!("vega-dl-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&temp_dir);

    let archive_path = temp_dir.join(if is_zip { "pkg.zip" } else { "pkg.tar.gz" });
    tokio::fs::write(&archive_path, &bytes)
        .await
        .map_err(|e| format!("Failed to write downloaded archive: {}", e))?;

    let extract_dir = temp_dir.join("extracted");
    let _ = std::fs::create_dir_all(&extract_dir);

    #[cfg(target_os = "windows")]
    {
        let ps_cmd = format!(
            "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
            archive_path.display(),
            extract_dir.display()
        );
        let status = tokio::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(&ps_cmd)
            .creation_flags(0x08000000)
            .status()
            .await
            .map_err(|e| format!("Failed to run Expand-Archive: {}", e))?;

        if !status.success() {
            return Err("Failed to extract downloaded archive via PowerShell".to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let status = if is_zip {
            tokio::process::Command::new("unzip")
                .arg("-o")
                .arg(&archive_path)
                .arg("-d")
                .arg(&extract_dir)
                .status()
                .await
        } else {
            tokio::process::Command::new("tar")
                .arg("-xzf")
                .arg(&archive_path)
                .arg("-C")
                .arg(&extract_dir)
                .status()
                .await
        }
        .map_err(|e| format!("Failed to extract downloaded archive: {}", e))?;

        if !status.success() {
            return Err("Extraction tool exited with error".to_string());
        }
    }

    let found_binary = find_file_recursive(&extract_dir, &exe_name, 5)
        .or_else(|| find_file_prefix_recursive(&extract_dir, base_name, 5));

    if let Some(src_bin) = found_binary {
        std::fs::copy(&src_bin, &target_file)
            .map_err(|e| format!("Failed to copy extracted binary: {}", e))?;

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ =
                std::fs::set_permissions(&target_file, std::fs::Permissions::from_mode(0o755));
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
        println!(
            "[proxy_manager] Successfully downloaded and installed {}",
            target_file.display()
        );
        Ok(target_file)
    } else {
        let _ = std::fs::remove_dir_all(&temp_dir);
        Err(format!(
            "Could not locate {} inside downloaded archive",
            exe_name
        ))
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn resolve_or_download_proxy_binary(
    _app: Option<&tauri::AppHandle>,
    _folder_name: &str,
    _base_name: &str,
) -> Result<PathBuf, String> {
    Err("Proxy manager is not supported on mobile platforms".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn resolve_or_download_proxy_binary(
    app: Option<&tauri::AppHandle>,
    folder_name: &str,
    base_name: &str,
) -> Result<PathBuf, String> {
    match resolve_proxy_binary(app, folder_name, base_name) {
        Ok(p) => Ok(p),
        Err(err) => {
            println!(
                "[proxy_manager] {} not found in local paths ({}), trying auto-download...",
                base_name, err
            );
            download_proxy_binary(folder_name, base_name).await
        }
    }
}

pub async fn stop_current_proxy_internal(state: &mut ActiveProxyState) {
    if let Some(mut child) = state.child.take() {
        let _ = child.kill().await;
    }
    if let Some(pid) = state.pid.take() {
        crate::process_guard::kill_pid(pid);
    }
    state.active_type = ProxyType::None;
    state.port = None;
    state.proxy_url = None;

    crate::doh_client::clear_client_cache().await;
    crate::stream_server::update_stream_proxy(None).await;
}

pub async fn stop_all_proxies() {
    let mut state = GLOBAL_PROXY_STATE.write().await;
    stop_current_proxy_internal(&mut state).await;
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub async fn start_byedpi(
    _app: tauri::AppHandle,
    _custom_args: Option<String>,
) -> Result<ProxyStatus, String> {
    Err("Proxy manager is not supported on mobile platforms".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn start_byedpi(
    app: tauri::AppHandle,
    custom_args: Option<String>,
) -> Result<ProxyStatus, String> {
    let bin_path = resolve_or_download_proxy_binary(Some(&app), "byedpi", "ciadpi").await?;
    let port = find_available_port()?;

    let args_str = custom_args
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "--split 1 --disorder 1 --auto=torst".to_string());

    let mut state = GLOBAL_PROXY_STATE.write().await;
    stop_current_proxy_internal(&mut state).await;

    let mut cmd = tokio::process::Command::new(&bin_path);
    cmd.arg("-i")
        .arg("127.0.0.1")
        .arg("-p")
        .arg(port.to_string());

    for arg in args_str.split_whitespace() {
        cmd.arg(arg);
    }

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());

    println!(
        "[proxy_manager] Launching ByeDPI: {:?} on port {}",
        bin_path, port
    );
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn ciadpi: {}", e))?;
    let pid = child.id();

    let ready = wait_for_port_ready(port, Duration::from_secs(3)).await;
    if !ready {
        if let Some(p) = pid {
            crate::process_guard::kill_pid(p);
        }
        return Err("ByeDPI process failed to start listening in time".to_string());
    }

    let proxy_url = format!("socks5h://127.0.0.1:{}", port);
    state.active_type = ProxyType::ByeDpi;
    state.port = Some(port);
    state.proxy_url = Some(proxy_url.clone());
    state.child = Some(child);
    state.pid = pid;

    crate::doh_client::clear_client_cache().await;
    crate::stream_server::update_stream_proxy(Some(proxy_url)).await;

    println!("[proxy_manager] ByeDPI active on port {}", port);
    Ok(ProxyStatus {
        proxy_type: ProxyType::ByeDpi,
        is_running: true,
        port: Some(port),
        error: None,
    })
}

#[tauri::command]
pub async fn stop_byedpi() -> Result<ProxyStatus, String> {
    let mut state = GLOBAL_PROXY_STATE.write().await;
    if state.active_type == ProxyType::ByeDpi {
        stop_current_proxy_internal(&mut state).await;
    }
    Ok(ProxyStatus {
        proxy_type: ProxyType::None,
        is_running: false,
        port: None,
        error: None,
    })
}

#[tauri::command]
pub async fn get_byedpi_status() -> ProxyStatus {
    let state = GLOBAL_PROXY_STATE.read().await;
    if state.active_type == ProxyType::ByeDpi {
        ProxyStatus {
            proxy_type: ProxyType::ByeDpi,
            is_running: true,
            port: state.port,
            error: None,
        }
    } else {
        ProxyStatus {
            proxy_type: ProxyType::ByeDpi,
            is_running: false,
            port: None,
            error: None,
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub async fn start_warp(_app: tauri::AppHandle) -> Result<ProxyStatus, String> {
    Err("Proxy manager is not supported on mobile platforms".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn start_warp(app: tauri::AppHandle) -> Result<ProxyStatus, String> {
    let bin_path = resolve_or_download_proxy_binary(Some(&app), "warp", "usque").await?;
    let config_dir = get_proxy_data_dir();
    let config_path = config_dir.join("warp_config.json");

    if !config_path.exists() {
        println!(
            "[proxy_manager] WARP config not found, registering new client at {:?}",
            config_path
        );
        let mut reg_cmd = tokio::process::Command::new(&bin_path);
        reg_cmd
            .arg("-c")
            .arg(&config_path)
            .arg("register")
            .arg("-a");

        #[cfg(target_os = "windows")]
        reg_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let output = reg_cmd
            .output()
            .await
            .map_err(|e| format!("Failed to register WARP client: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("WARP registration failed: {}", stderr));
        }
    }

    let port = find_available_port()?;

    let mut state = GLOBAL_PROXY_STATE.write().await;
    stop_current_proxy_internal(&mut state).await;

    let mut cmd = tokio::process::Command::new(&bin_path);
    cmd.arg("-c")
        .arg(&config_path)
        .arg("http-proxy")
        .arg("-b")
        .arg("127.0.0.1")
        .arg("-p")
        .arg(port.to_string());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());

    println!(
        "[proxy_manager] Launching WARP: {:?} on port {}",
        bin_path, port
    );
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn usque: {}", e))?;
    let pid = child.id();

    let ready = wait_for_port_ready(port, Duration::from_secs(5)).await;
    if !ready {
        if let Some(p) = pid {
            crate::process_guard::kill_pid(p);
        }
        return Err("WARP proxy failed to start listening in time".to_string());
    }

    let proxy_url = format!("http://127.0.0.1:{}", port);
    state.active_type = ProxyType::Warp;
    state.port = Some(port);
    state.proxy_url = Some(proxy_url.clone());
    state.child = Some(child);
    state.pid = pid;

    crate::doh_client::clear_client_cache().await;
    crate::stream_server::update_stream_proxy(Some(proxy_url)).await;

    println!("[proxy_manager] WARP active on port {}", port);
    Ok(ProxyStatus {
        proxy_type: ProxyType::Warp,
        is_running: true,
        port: Some(port),
        error: None,
    })
}

#[tauri::command]
pub async fn stop_warp() -> Result<ProxyStatus, String> {
    let mut state = GLOBAL_PROXY_STATE.write().await;
    if state.active_type == ProxyType::Warp {
        stop_current_proxy_internal(&mut state).await;
    }
    Ok(ProxyStatus {
        proxy_type: ProxyType::None,
        is_running: false,
        port: None,
        error: None,
    })
}

#[tauri::command]
pub async fn get_warp_status() -> ProxyStatus {
    let state = GLOBAL_PROXY_STATE.read().await;
    if state.active_type == ProxyType::Warp {
        ProxyStatus {
            proxy_type: ProxyType::Warp,
            is_running: true,
            port: state.port,
            error: None,
        }
    } else {
        ProxyStatus {
            proxy_type: ProxyType::Warp,
            is_running: false,
            port: None,
            error: None,
        }
    }
}

#[tauri::command]
pub async fn get_active_proxy_status() -> ProxyStatus {
    let state = GLOBAL_PROXY_STATE.read().await;
    ProxyStatus {
        proxy_type: state.active_type,
        is_running: state.port.is_some(),
        port: state.port,
        error: None,
    }
}

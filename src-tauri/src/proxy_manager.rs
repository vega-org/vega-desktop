use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
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

pub fn resolve_proxy_binary(folder_name: &str, base_name: &str) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let exe_name = format!("{}.exe", base_name);
    #[cfg(not(target_os = "windows"))]
    let exe_name = base_name.to_string();

    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidate_dirs.push(parent.join("resources").join(folder_name));
            candidate_dirs.push(parent.join("resources").join("resources").join(folder_name));
            candidate_dirs.push(parent.join(folder_name));
            candidate_dirs.push(parent.to_path_buf());

            if let Some(contents) = parent.parent() {
                candidate_dirs.push(contents.join("Resources").join(folder_name));
                candidate_dirs.push(contents.join("Resources").join("resources").join(folder_name));
                candidate_dirs.push(contents.join("resources").join(folder_name));
            }
            if let Some(target_dir) = parent.parent() {
                if let Some(src_tauri_dir) = target_dir.parent() {
                    candidate_dirs.push(src_tauri_dir.join("resources").join(folder_name));
                }
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidate_dirs.push(cwd.join("src-tauri").join("resources").join(folder_name));
        candidate_dirs.push(cwd.join("resources").join(folder_name));
        candidate_dirs.push(cwd.join(folder_name));
        candidate_dirs.push(cwd);
    }

    for dir in &candidate_dirs {
        let candidate = dir.join(&exe_name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

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

#[tauri::command]
pub async fn start_byedpi(custom_args: Option<String>) -> Result<ProxyStatus, String> {
    let bin_path = resolve_proxy_binary("byedpi", "ciadpi")?;
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

#[tauri::command]
pub async fn start_warp() -> Result<ProxyStatus, String> {
    let bin_path = resolve_proxy_binary("warp", "usque")?;
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

use std::path::PathBuf;
use std::process::Command;

#[cfg(target_os = "windows")]
const FFMPEG_BIN_NAME: &str = "ffmpeg.exe";
#[cfg(not(target_os = "windows"))]
const FFMPEG_BIN_NAME: &str = "ffmpeg";

#[cfg(target_os = "windows")]
const FFPROBE_BIN_NAME: &str = "ffprobe.exe";
#[cfg(not(target_os = "windows"))]
const FFPROBE_BIN_NAME: &str = "ffprobe";

/// Returns candidate file names including potential Tauri target triple suffixes.
fn get_candidate_names(base_name: &str) -> Vec<String> {
    let mut names = vec![base_name.to_string()];

    #[cfg(target_os = "windows")]
    {
        names.push(format!("{}-x86_64-pc-windows-msvc.exe", base_name.trim_end_matches(".exe")));
        names.push(format!("{}-aarch64-pc-windows-msvc.exe", base_name.trim_end_matches(".exe")));
    }
    #[cfg(target_os = "linux")]
    {
        names.push(format!("{}-x86_64-unknown-linux-gnu", base_name));
        names.push(format!("{}-aarch64-unknown-linux-gnu", base_name));
    }
    #[cfg(target_os = "macos")]
    {
        names.push(format!("{}-x86_64-apple-darwin", base_name));
        names.push(format!("{}-aarch64-apple-darwin", base_name));
        names.push(format!("{}-universal-apple-darwin", base_name));
    }

    names
}

pub fn resolve_binary(base_name: &str, env_var: &str) -> Result<PathBuf, String> {
    if let Ok(custom_path) = std::env::var(env_var) {
        let p = PathBuf::from(custom_path);
        if p.exists() {
            return Ok(p);
        }
    }

    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidate_dirs.push(parent.to_path_buf());
            candidate_dirs.push(parent.join("resources").join("ffmpeg"));
            candidate_dirs.push(parent.join("resources"));
            candidate_dirs.push(parent.join("binaries"));
            candidate_dirs.push(parent.join("bin"));
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidate_dirs.push(cwd.join("resources").join("ffmpeg"));
        candidate_dirs.push(cwd.join("src-tauri").join("resources").join("ffmpeg"));
        candidate_dirs.push(cwd.join("src-tauri").join("binaries"));
        candidate_dirs.push(cwd.join("binaries"));
        candidate_dirs.push(cwd.join("ffmpeg"));
        candidate_dirs.push(cwd.clone());
    }

    let candidate_names = get_candidate_names(base_name);

    for dir in &candidate_dirs {
        for name in &candidate_names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    // Check system PATH
    let check_cmd = Command::new(base_name)
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    if let Ok(status) = check_cmd {
        if status.success() {
            return Ok(PathBuf::from(base_name));
        }
    }

    Err(format!(
        "Binary '{}' could not be found in bundled sidecars, resources, app directories, or system PATH.",
        base_name
    ))
}

pub fn get_ffmpeg_path() -> Result<PathBuf, String> {
    resolve_binary(FFMPEG_BIN_NAME, "VEGA_FFMPEG_PATH")
}

pub fn get_ffprobe_path() -> Result<PathBuf, String> {
    resolve_binary(FFPROBE_BIN_NAME, "VEGA_FFPROBE_PATH")
}

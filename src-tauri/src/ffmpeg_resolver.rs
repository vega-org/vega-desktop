use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
const FFMPEG_BIN_NAME: &str = "ffmpeg.exe";
#[cfg(not(target_os = "windows"))]
const FFMPEG_BIN_NAME: &str = "ffmpeg";

#[cfg(target_os = "windows")]
const FFPROBE_BIN_NAME: &str = "ffprobe.exe";
#[cfg(not(target_os = "windows"))]
const FFPROBE_BIN_NAME: &str = "ffprobe";

/// Cleans a file URL or path into a platform-appropriate local filesystem path or URL.
pub fn clean_source(source: &str) -> String {
    // If it's a local stream proxy URL like http://127.0.0.1:port/file?path=...
    if (source.starts_with("http://127.0.0.1:") || source.starts_with("http://localhost:"))
        && source.contains("/file?path=")
    {
        if let Some(pos) = source.find("/file?path=") {
            let encoded_path = &source[pos + "/file?path=".len()..];
            let decoded = urlencoding::decode(encoded_path)
                .map(|cow| cow.into_owned())
                .unwrap_or_else(|_| encoded_path.to_string());
            if std::path::Path::new(&decoded).is_file() {
                return decoded;
            }
        }
    }

    if source.starts_with("file://") {
        #[cfg(target_os = "windows")]
        {
            let path_part = if let Some(stripped) = source.strip_prefix("file:///") {
                stripped
            } else if let Some(stripped) = source.strip_prefix("file://") {
                stripped
            } else {
                source
            };
            let decoded = urlencoding::decode(path_part)
                .map(|cow| cow.into_owned())
                .unwrap_or_else(|_| path_part.to_string());
            decoded.replace('/', "\\")
        }
        #[cfg(not(target_os = "windows"))]
        {
            // On Unix (Linux / macOS), file:///path has 3 slashes where the 3rd slash is the filesystem root.
            let path_part = if let Some(stripped) = source.strip_prefix("file://") {
                stripped
            } else {
                source
            };
            urlencoding::decode(path_part)
                .map(|cow| cow.into_owned())
                .unwrap_or_else(|_| path_part.to_string())
        }
    } else {
        source.to_string()
    }
}

/// Prepend a directory to PATH in a std::process::Command with platform-appropriate delimiter.
pub fn prepend_to_path_env(cmd: &mut Command, dir: &Path) {
    #[cfg(target_os = "windows")]
    let sep = ";";
    #[cfg(not(target_os = "windows"))]
    let sep = ":";

    if let Ok(path_var) = std::env::var("PATH") {
        cmd.env("PATH", format!("{}{}{}", dir.display(), sep, path_var));
    } else {
        cmd.env("PATH", dir);
    }
}

/// Prepend a directory to PATH in a tokio::process::Command with platform-appropriate delimiter.
pub fn prepend_to_path_tokio(cmd: &mut tokio::process::Command, dir: &Path) {
    #[cfg(target_os = "windows")]
    let sep = ";";
    #[cfg(not(target_os = "windows"))]
    let sep = ":";

    if let Ok(path_var) = std::env::var("PATH") {
        cmd.env("PATH", format!("{}{}{}", dir.display(), sep, path_var));
    } else {
        cmd.env("PATH", dir);
    }
}

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
            if let Some(contents) = parent.parent() {
                candidate_dirs.push(contents.join("Resources").join("ffmpeg"));
                candidate_dirs.push(contents.join("Resources"));
                candidate_dirs.push(contents.join("resources").join("ffmpeg"));
                candidate_dirs.push(contents.join("resources"));
            }
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

    #[cfg(target_os = "macos")]
    {
        candidate_dirs.push(PathBuf::from("/opt/homebrew/bin"));
        candidate_dirs.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(target_os = "linux")]
    {
        candidate_dirs.push(PathBuf::from("/usr/bin"));
        candidate_dirs.push(PathBuf::from("/usr/local/bin"));
        candidate_dirs.push(PathBuf::from("/usr/lib/ffmpeg"));
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

    // Check system PATH explicitly to resolve canonical path
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for name in &candidate_names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    // Check system PATH via invocation fallback
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

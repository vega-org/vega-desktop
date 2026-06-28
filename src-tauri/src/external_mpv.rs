use std::collections::HashMap;

/// Launch an external `mpv` process for Linux playback.
///
/// On Linux the embedded libmpv path (tauri-plugin-libmpv) requires Vulkan
/// and a raw XID surface from the WebKitGTK compositor.  Both are
/// unavailable in a Docker / X11-forwarded environment, which causes
/// playback to silently stall at 00:00.  This command bypasses the
/// embedded path entirely: mpv creates its own X11 window, negotiates its
/// own OpenGL/EGL context, and falls back gracefully through
/// gpu → xv → x11 video outputs.
///
/// Returns a descriptive error string on failure so the TypeScript caller
/// can surface it to the user without a generic "command failed" message.
#[tauri::command]
pub fn launch_mpv(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
    // On non-Linux platforms this command is registered but intentionally
    // inert – the TypeScript side guards with IS_LINUX before calling it.
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (url, headers);
        return Err("external mpv backend is Linux-only".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let mut cmd = Command::new("mpv");

        // Use gpu (not gpu-next) for broad driver compatibility on X11/Docker.
        // Disable hardware decoding; VAAPI/VDPAU are absent in most containers.
        cmd.arg("--fullscreen")
            .arg("--vo=gpu")
            .arg("--hwdec=no");

        if let Some(ref hdrs) = headers {
            // Separate User-Agent (mpv flag) from other HTTP headers (csv list).
            let fields: Vec<String> = hdrs
                .iter()
                .filter(|(k, _)| k.to_lowercase() != "user-agent")
                .map(|(k, v)| format!("{}: {}", k, v))
                .collect();

            if !fields.is_empty() {
                cmd.arg(format!("--http-header-fields={}", fields.join(",")));
            }

            let ua = hdrs
                .get("user-agent")
                .or_else(|| hdrs.get("User-Agent"))
                .map(String::as_str)
                .unwrap_or(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
                     (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                );
            cmd.arg(format!("--user-agent={}", ua));
        }

        cmd.arg(&url);
        cmd.spawn()
            .map_err(|e| format!("failed to launch mpv: {}", e))?;
        Ok(())
    }
}

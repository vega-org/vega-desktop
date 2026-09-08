use crate::ffmpeg_resolver;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::{Mutex, Notify};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeStreamInfo {
    pub index: u32,
    pub codec_type: String,
    pub codec_name: Option<String>,
    pub profile: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub bit_depth: Option<u32>,
    pub channels: Option<u32>,
    pub channel_layout: Option<String>,
    pub language: Option<String>,
    pub title: Option<String>,
    pub is_default: bool,
    pub is_bitmap_sub: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeChapterInfo {
    pub id: i64,
    pub title: String,
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaProbeResult {
    pub format_name: Option<String>,
    pub duration: f64,
    pub video_tracks: Vec<ProbeStreamInfo>,
    pub audio_tracks: Vec<ProbeStreamInfo>,
    pub subtitle_tracks: Vec<ProbeStreamInfo>,
    pub chapters: Vec<ProbeChapterInfo>,
}

#[derive(Deserialize)]
struct FfprobeOutput {
    format: Option<FfprobeFormat>,
    streams: Option<Vec<FfprobeStream>>,
    chapters: Option<Vec<FfprobeChapter>>,
}

#[derive(Deserialize)]
struct FfprobeFormat {
    format_name: Option<String>,
    duration: Option<String>,
}

#[derive(Deserialize)]
struct FfprobeStream {
    index: u32,
    codec_type: Option<String>,
    codec_name: Option<String>,
    profile: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    pix_fmt: Option<String>,
    bits_per_raw_sample: Option<String>,
    channels: Option<u32>,
    channel_layout: Option<String>,
    tags: Option<HashMap<String, String>>,
    disposition: Option<HashMap<String, i32>>,
}

#[derive(Deserialize)]
struct FfprobeChapter {
    id: i64,
    start_time: Option<String>,
    end_time: Option<String>,
    tags: Option<HashMap<String, String>>,
}

fn format_headers_arg(headers: &HashMap<String, String>) -> Option<String> {
    let mut lines = Vec::new();
    let allowed = ["referer", "user-agent", "origin", "cookie", "authorization"];
    for (k, v) in headers {
        let lower = k.to_lowercase();
        if allowed.contains(&lower.as_str()) {
            let sanitized = v.replace('\r', "").replace('\n', "");
            lines.push(format!("{}: {}", k, sanitized));
        }
    }
    if lines.is_empty() {
        None
    } else {
        lines.push(String::new());
        Some(lines.join("\r\n"))
    }
}

pub async fn probe_media(
    source: &str,
    headers: Option<HashMap<String, String>>,
) -> Result<MediaProbeResult, String> {
    let ffprobe_path = ffmpeg_resolver::get_ffprobe_path()?;
    let mut cmd = Command::new(&ffprobe_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    if let Some(parent) = ffprobe_path.parent().filter(|p| !p.as_os_str().is_empty()) {
        cmd.current_dir(parent);
        crate::ffmpeg_resolver::prepend_to_path_tokio(&mut cmd, parent);
    }

    cmd.arg("-v")
        .arg("error")
        .arg("-analyzeduration")
        .arg("5000000")
        .arg("-probesize")
        .arg("5000000")
        .arg("-show_format")
        .arg("-show_streams")
        .arg("-show_chapters")
        .arg("-of")
        .arg("json");

    if let Some(ref h) = headers {
        if let Some(formatted) = format_headers_arg(h) {
            cmd.arg("-headers").arg(formatted);
        }
    }

    let clean_source = crate::ffmpeg_resolver::clean_source(source);
    cmd.arg(&clean_source);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let output = tokio::time::timeout(std::time::Duration::from_secs(25), cmd.output())
        .await
        .map_err(|_| "ffprobe probe timed out".to_string())?
        .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

    if !output.status.success() {
        let err_str = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe error: {}", err_str));
    }

    let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse ffprobe json: {}", e))?;

    let duration = parsed
        .format
        .as_ref()
        .and_then(|f| f.duration.as_ref())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);

    let format_name = parsed.format.and_then(|f| f.format_name);

    let mut video_tracks = Vec::new();
    let mut audio_tracks = Vec::new();
    let mut subtitle_tracks = Vec::new();

    if let Some(streams) = parsed.streams {
        for s in streams {
            let codec_type = s.codec_type.unwrap_or_default().to_lowercase();
            let codec_name = s.codec_name.map(|c| c.to_lowercase());
            let language = s.tags.as_ref().and_then(|t| {
                t.get("language")
                    .or_else(|| t.get("LANGUAGE"))
                    .or_else(|| t.get("lang"))
                    .cloned()
            });
            let title = s.tags.as_ref().and_then(|t| {
                t.get("title")
                    .or_else(|| t.get("TITLE"))
                    .cloned()
            });

            let is_default = s
                .disposition
                .as_ref()
                .and_then(|d| d.get("default"))
                .copied()
                .unwrap_or(0)
                == 1;

            let fps = s.r_frame_rate.and_then(|rate_str| {
                if let Some((num, den)) = rate_str.split_once('/') {
                    let n = num.parse::<f64>().ok()?;
                    let d = den.parse::<f64>().ok()?;
                    if d > 0.0 {
                        Some(n / d)
                    } else {
                        None
                    }
                } else {
                    rate_str.parse::<f64>().ok()
                }
            });

            let bit_depth = s
                .bits_per_raw_sample
                .as_ref()
                .and_then(|b| b.parse::<u32>().ok())
                .or_else(|| {
                    if let Some(ref pix) = s.pix_fmt {
                        if pix.contains("10") {
                            Some(10)
                        } else if pix.contains("12") {
                            Some(12)
                        } else {
                            Some(8)
                        }
                    } else {
                        None
                    }
                });

            let is_bitmap_sub = match codec_name.as_deref() {
                Some("hdmv_pgs_subtitle") | Some("dvd_subtitle") | Some("dvdsub") => true,
                _ => false,
            };

            let info = ProbeStreamInfo {
                index: s.index,
                codec_type: codec_type.clone(),
                codec_name,
                profile: s.profile,
                width: s.width,
                height: s.height,
                fps,
                bit_depth,
                channels: s.channels,
                channel_layout: s.channel_layout,
                language,
                title,
                is_default,
                is_bitmap_sub,
            };

            match codec_type.as_str() {
                "video" => video_tracks.push(info),
                "audio" => audio_tracks.push(info),
                "subtitle" => subtitle_tracks.push(info),
                _ => {}
            }
        }
    }

    let mut chapters = Vec::new();
    if let Some(chaps) = parsed.chapters {
        for c in chaps {
            let start_time = c
                .start_time
                .as_ref()
                .and_then(|t| t.parse::<f64>().ok())
                .unwrap_or(0.0);
            let end_time = c
                .end_time
                .as_ref()
                .and_then(|t| t.parse::<f64>().ok())
                .unwrap_or(0.0);
            let title = c
                .tags
                .as_ref()
                .and_then(|t| t.get("title").cloned())
                .unwrap_or_else(|| format!("Chapter {}", c.id));

            chapters.push(ProbeChapterInfo {
                id: c.id,
                title,
                start_time,
                end_time,
            });
        }
    }

    Ok(MediaProbeResult {
        format_name,
        duration,
        video_tracks,
        audio_tracks,
        subtitle_tracks,
        chapters,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleUpdatePayload {
    pub source: String,
    pub track_index: u32,
    pub subtitles: String,
    pub is_final: bool,
}

#[derive(Clone)]
struct ActiveSubExtraction {
    buffer: Arc<Mutex<String>>,
    notify: Arc<Notify>,
    is_done: Arc<AtomicBool>,
}

lazy_static! {
    static ref ACTIVE_EXTRACTIONS: Mutex<HashMap<String, ActiveSubExtraction>> =
        Mutex::new(HashMap::new());
    static ref SOURCE_ACTIVE_EXTRACT: Mutex<HashMap<String, (u32, tokio::sync::oneshot::Sender<()>)>> =
        Mutex::new(HashMap::new());
}

pub fn get_subs_cache_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join("vega_subs_cache");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn compute_sub_cache_key(source: &str, sub_index: u32) -> String {
    // Strip query parameters if URL so signed expiration tokens don't change cache key
    let base = if let Some((path, _)) = source.split_once('?') {
        path
    } else {
        source
    };
    // Deterministic FNV-1a 64-bit hash
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in base.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}_{}", hash, sub_index)
}

pub async fn extract_subtitles_to_string(
    app: Option<tauri::AppHandle>,
    source: &str,
    sub_index: u32,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let clean_source = crate::ffmpeg_resolver::clean_source(source);

    let cache_dir = get_subs_cache_dir();
    let cache_key = compute_sub_cache_key(&clean_source, sub_index);
    let srt_path = cache_dir.join(format!("{}.srt", cache_key));
    let done_path = cache_dir.join(format!("{}.done", cache_key));

    // 1. Check if complete subtitle file exists in disk cache
    if srt_path.exists() {
        if let Ok(cached) = tokio::fs::read_to_string(&srt_path).await {
            if !cached.trim().is_empty() && cached.contains("-->") {
                if done_path.exists() {
                    return Ok(cached);
                }
            }
        }
    }

    // Cancel any in-flight extraction on this same source for a different subtitle track
    {
        let mut src_map = SOURCE_ACTIVE_EXTRACT.lock().await;
        if let Some((prev_idx, prev_cancel)) = src_map.remove(&clean_source) {
            if prev_idx != sub_index {
                let _ = prev_cancel.send(());
            }
        }
    }

    // 2. Check if extraction is already active
    let (active, is_new) = {
        let mut map = ACTIVE_EXTRACTIONS.lock().await;
        if let Some(existing) = map.get(&cache_key) {
            (existing.clone(), false)
        } else {
            let new_active = ActiveSubExtraction {
                buffer: Arc::new(Mutex::new(String::new())),
                notify: Arc::new(Notify::new()),
                is_done: Arc::new(AtomicBool::new(false)),
            };
            map.insert(cache_key.clone(), new_active.clone());
            (new_active, true)
        }
    };

    if !is_new {
        // If extraction is already running, check if it already has cues
        {
            let buf = active.buffer.lock().await;
            if buf.contains("-->") {
                return Ok(buf.clone());
            }
        }
        // Wait up to 2.0s for initial cues to arrive
        let _ = tokio::time::timeout(std::time::Duration::from_millis(2000), active.notify.notified()).await;
        let buf = active.buffer.lock().await.clone();
        return Ok(buf);
    }

    // 3. Setup and spawn FFmpeg for extraction
    let is_network = clean_source.starts_with("http://") || clean_source.starts_with("https://");
    let ffmpeg_path = ffmpeg_resolver::get_ffmpeg_path()?;
    let mut cmd = Command::new(&ffmpeg_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    if let Some(parent) = ffmpeg_path.parent().filter(|p| !p.as_os_str().is_empty()) {
        cmd.current_dir(parent);
        crate::ffmpeg_resolver::prepend_to_path_tokio(&mut cmd, parent);
    }

    cmd.arg("-v").arg("error");

    if is_network {
        cmd.arg("-reconnect")
            .arg("1")
            .arg("-reconnect_at_eof")
            .arg("1")
            .arg("-reconnect_streamed")
            .arg("1")
            .arg("-reconnect_delay_max")
            .arg("5");
    }

    if let Some(ref h) = headers {
        if let Some(formatted) = format_headers_arg(h) {
            cmd.arg("-headers").arg(formatted);
        }
    }

    cmd.arg("-i")
        .arg(&clean_source)
        .arg("-map")
        .arg(format!("0:{}", sub_index))
        .arg("-vn")
        .arg("-an")
        .arg("-c:s")
        .arg("srt")
        .arg("-f")
        .arg("srt")
        .arg("-flush_packets")
        .arg("1")
        .arg("pipe:1");

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let mut map = ACTIVE_EXTRACTIONS.lock().await;
            map.remove(&cache_key);
            return Err(format!("Failed to spawn ffmpeg: {}", e));
        }
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let mut map = ACTIVE_EXTRACTIONS.lock().await;
            map.remove(&cache_key);
            return Err("Failed to capture ffmpeg stdout".to_string());
        }
    };

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut src_map = SOURCE_ACTIVE_EXTRACT.lock().await;
        src_map.insert(clean_source.clone(), (sub_index, cancel_tx));
    }

    let buffer_clone = Arc::clone(&active.buffer);
    let notify_clone = Arc::clone(&active.notify);
    let is_done_clone = Arc::clone(&active.is_done);
    let srt_path_clone = srt_path.clone();
    let done_path_clone = done_path.clone();
    let cache_key_clone = cache_key.clone();
    let source_string = source.to_string();
    let clean_source_clone = clean_source.clone();
    let app_opt = app.clone();

    let spawn_time = std::time::Instant::now();
    eprintln!("[subs] Starting extraction for track {} from {}", sub_index, &clean_source[..clean_source.len().min(80)]);

    tokio::spawn(async move {
        let mut reader = stdout;
        let mut chunk = [0u8; 8192];
        let mut last_progress_emit = std::time::Instant::now();
        let mut had_cues = false;

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    eprintln!("[subs] Extraction cancelled for track {} after {}ms", sub_index, spawn_time.elapsed().as_millis());
                    let _ = child.kill().await;
                    break;
                }
                res = reader.read(&mut chunk) => {
                    match res {
                        Ok(0) => break,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&chunk[..n]);
                            let is_first_cue;
                            let current;
                            {
                                let mut lock = buffer_clone.lock().await;
                                lock.push_str(&text);
                                is_first_cue = !had_cues && lock.contains("-->");
                                if is_first_cue {
                                    had_cues = true;
                                    eprintln!("[subs] First cue arrived for track {} after {}ms, buffer={}bytes", sub_index, spawn_time.elapsed().as_millis(), lock.len());
                                    notify_clone.notify_waiters();
                                }
                                current = lock.clone();
                            }

                            if current.contains("-->") && (is_first_cue || last_progress_emit.elapsed() >= std::time::Duration::from_millis(1500)) {
                                last_progress_emit = std::time::Instant::now();
                                let _ = tokio::fs::write(&srt_path_clone, &current).await;
                                if let Some(ref app) = app_opt {
                                    eprintln!("[subs] Emitting progressive update for track {}, len={}", sub_index, current.len());
                                    use tauri::Emitter;
                                    let _ = app.emit(
                                        "subtitles_updated",
                                        SubtitleUpdatePayload {
                                            source: source_string.clone(),
                                            track_index: sub_index,
                                            subtitles: current,
                                            is_final: false,
                                        },
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("[subs] Error reading ffmpeg stdout: {}", e);
                            break;
                        }
                    }
                }
            }
        }

        let status = child.wait().await;
        let success = status.map(|s| s.success()).unwrap_or(false);
        let final_text = buffer_clone.lock().await.clone();

        if success && !final_text.trim().is_empty() && final_text.contains("-->") {
            let _ = tokio::fs::write(&srt_path_clone, &final_text).await;
            let _ = tokio::fs::write(&done_path_clone, "1").await;
        } else if !final_text.trim().is_empty() && final_text.contains("-->") {
            let _ = tokio::fs::write(&srt_path_clone, &final_text).await;
        }

        is_done_clone.store(true, Ordering::SeqCst);
        notify_clone.notify_waiters();

        if let Some(ref app) = app_opt {
            if !final_text.trim().is_empty() && final_text.contains("-->") {
                use tauri::Emitter;
                let _ = app.emit(
                    "subtitles_updated",
                    SubtitleUpdatePayload {
                        source: source_string.clone(),
                        track_index: sub_index,
                        subtitles: final_text,
                        is_final: true,
                    },
                );
            }
        }

        {
            let mut map = ACTIVE_EXTRACTIONS.lock().await;
            map.remove(&cache_key_clone);
        }
        {
            let mut src_map = SOURCE_ACTIVE_EXTRACT.lock().await;
            if let Some((idx, _)) = src_map.get(&clean_source_clone) {
                if *idx == sub_index {
                    src_map.remove(&clean_source_clone);
                }
            }
        }
    });

    // 4. Return initial subtitles quickly to caller (wait up to 2.0s for local/cached/fast sources)
    let _ = tokio::time::timeout(std::time::Duration::from_millis(2000), active.notify.notified()).await;
    let initial = active.buffer.lock().await.clone();
    if !initial.trim().is_empty() && initial.contains("-->") {
        return Ok(initial);
    }

    Ok(initial)
}

pub async fn find_seek_keyframe(
    source: &str,
    target_time: f64,
    headers: Option<HashMap<String, String>>,
) -> Option<f64> {
    if target_time <= 0.05 {
        return Some(0.0);
    }

    let clean_source = crate::ffmpeg_resolver::clean_source(source);

    let ffprobe_path = match ffmpeg_resolver::get_ffprobe_path() {
        Ok(p) => p,
        Err(_) => return None,
    };

    let mut cmd = Command::new(&ffprobe_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    if let Some(parent) = ffprobe_path.parent().filter(|p| !p.as_os_str().is_empty()) {
        cmd.current_dir(parent);
        crate::ffmpeg_resolver::prepend_to_path_tokio(&mut cmd, parent);
    }

    cmd.arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("packet=pts_time,flags")
        .arg("-read_intervals")
        .arg(format!("{:.3}%+1", target_time))
        .arg("-of")
        .arg("csv=p=0");

    if let Some(ref h) = headers {
        if let Some(formatted) = format_headers_arg(h) {
            cmd.arg("-headers").arg(formatted);
        }
    }

    cmd.arg(&clean_source);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());

    let output = match tokio::time::timeout(std::time::Duration::from_millis(1500), cmd.output()).await {
        Ok(Ok(o)) => o,
        _ => return None,
    };

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((pts_str, flags)) = trimmed.split_once(',') {
            if flags.contains('K') {
                if let Ok(pts) = pts_str.trim().parse::<f64>() {
                    return Some(pts);
                }
            }
        }
    }

    None
}



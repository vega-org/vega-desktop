use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc::{self, Sender};
use tokio::sync::{Mutex, Semaphore};
use futures_util::StreamExt;

#[derive(Clone, Serialize)]
pub struct ProgressPayload {
    pub id: String,
    pub downloaded: u64,
    pub total: u64,
    pub speed: u64, // bytes per second
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<crate::parallel_download::ConnectionDetails>,
}

#[derive(Clone, Serialize)]
pub struct CompletePayload {
    pub id: String,
    pub final_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSubtitle {
    pub path: String,
    pub language: String,
}

// Global state for download manager
pub struct DownloadState {
    pub active_downloads: Arc<Mutex<HashMap<String, Sender<()>>>>,
}

impl DownloadState {
    pub fn new() -> Self {
        Self {
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub(crate) fn validate_download_path(base_dir: &str, file_path: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(base_dir);
    let target = PathBuf::from(file_path);
    if !base.is_absolute() || !target.is_absolute() {
        return Err("Download paths must be absolute".into());
    }

    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let canonical_base = std::fs::canonicalize(&base).map_err(|e| e.to_string())?;
    let relative = target
        .strip_prefix(&base)
        .map_err(|_| "Download path is outside the configured directory".to_string())?;
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Invalid download path".into());
    }

    let mut existing_ancestor = target.as_path();
    while !existing_ancestor.exists() {
        existing_ancestor = existing_ancestor
            .parent()
            .ok_or_else(|| "Invalid download path".to_string())?;
    }
    let canonical_ancestor = std::fs::canonicalize(existing_ancestor).map_err(|e| e.to_string())?;
    if !canonical_ancestor.starts_with(&canonical_base) {
        return Err("Download path escapes the configured directory".into());
    }

    Ok(target)
}

#[tauri::command]
pub async fn save_subtitle(base_dir: String, path: String, content: String) -> Result<(), String> {
    let path = validate_download_path(&base_dir, &path)?;
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension)
            if extension.eq_ignore_ascii_case("srt") || extension.eq_ignore_ascii_case("vtt") => {}
        _ => return Err("Unsupported subtitle file extension".into()),
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_download_subtitles(
    base_dir: String,
    file_path: String,
) -> Result<Vec<LocalSubtitle>, String> {
    let path = validate_download_path(&base_dir, &file_path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid download path".to_string())?;
    let base_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Invalid download filename".to_string())?;
    let prefix_dot = format!("{base_name}.");
    let prefix_dash = format!("{base_name} - ");
    let mut subtitles = Vec::new();

    for entry in std::fs::read_dir(parent).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let extension = entry_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if !extension.eq_ignore_ascii_case("srt") && !extension.eq_ignore_ascii_case("vtt") {
            continue;
        }

        let file_name = entry.file_name();
        let Some(file_name_str) = file_name.to_str() else {
            continue;
        };

        let language = if let Some(lang) = file_name_str
            .strip_prefix(&prefix_dot)
            .and_then(|value| value.strip_suffix(&format!(".{extension}")))
        {
            lang.to_string()
        } else if let Some(lang) = file_name_str
            .strip_prefix(&prefix_dash)
            .and_then(|value| value.strip_suffix(&format!(".{extension}")))
        {
            lang.to_string()
        } else {
            continue;
        };

        subtitles.push(LocalSubtitle {
            path: entry_path.to_string_lossy().into_owned(),
            language,
        });
    }

    Ok(subtitles)
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, DownloadState>,
    id: String,
    url: String,
    base_dir: String,
    file_path: String,
    headers: Option<HashMap<String, String>>,
    video_type: Option<String>,
    connections: Option<usize>,
) -> Result<(), String> {
    let path = validate_download_path(&base_dir, &file_path)?;
    let connections = connections
        .unwrap_or(4)
        .clamp(1, crate::parallel_download::MAX_CONNECTIONS);
    let mut client_builder = Client::builder().danger_accept_invalid_certs(true); // For scraping generic streams

    let mut header_map = reqwest::header::HeaderMap::new();
    let mut has_user_agent = false;

    if let Some(h) = headers {
        for (k, v) in h {
            if let Ok(name) = reqwest::header::HeaderName::from_str(&k) {
                if let Ok(value) = reqwest::header::HeaderValue::from_str(&v) {
                    if name == reqwest::header::USER_AGENT {
                        has_user_agent = true;
                    }
                    header_map.insert(name, value);
                }
            }
        }
    }

    if !has_user_agent {
        header_map.insert(
            reqwest::header::USER_AGENT,
            reqwest::header::HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            ),
        );
    }

    client_builder = client_builder.default_headers(header_map);
    let client = client_builder.build().map_err(|e| e.to_string())?;

    if url.contains(".m3u8") || video_type.as_deref() == Some("m3u8") {
        return download_m3u8(app, state, id, url, file_path, client, connections).await;
    }

    let part_path = path.with_extension("part");
    if let Some(parent) = part_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let (cancel_tx, mut cancel_rx) = mpsc::channel::<()>(1);
    {
        let mut active = state.active_downloads.lock().await;
        active.insert(id.clone(), cancel_tx);
    }

    let on_progress = |downloaded, total, speed, details| {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                id: id.clone(),
                downloaded,
                total,
                speed,
                details,
            },
        );
    };
    let outcome = crate::parallel_download::download(
        &on_progress,
        &client,
        &url,
        &part_path,
        connections,
        &mut cancel_rx,
    )
    .await;
    {
        let mut active = state.active_downloads.lock().await;
        active.remove(&id);
    }

    match outcome? {
        crate::parallel_download::Outcome::Paused => {
            vlog_debug!("Download paused: {}", id);
            Ok(())
        }
        // The URL has no .m3u8 in it, but the server answered with a playlist.
        crate::parallel_download::Outcome::Playlist => {
            download_m3u8(app, state, id, url, file_path, client, connections).await
        }
        crate::parallel_download::Outcome::Completed => {
            std::fs::rename(&part_path, &path).map_err(|e| e.to_string())?;
            let _ = app.emit(
                "download-complete",
                CompletePayload {
                    id: id.clone(),
                    final_path: file_path.clone(),
                },
            );
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn pause_download(state: State<'_, DownloadState>, id: String) -> Result<(), String> {
    let mut active = state.active_downloads.lock().await;
    if let Some(tx) = active.remove(&id) {
        let _ = tx.send(()).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_download(
    state: State<'_, DownloadState>,
    id: String,
    file_path: String,
    base_dir: String,
) -> Result<(), String> {
    // First pause it
    let mut active = state.active_downloads.lock().await;
    if let Some(tx) = active.remove(&id) {
        let _ = tx.send(()).await;
    }

    // Then delete the partial file
    let path = validate_download_path(&base_dir, &file_path)?;
    let part_path = path.with_extension("part");
    let _ = std::fs::remove_file(crate::parallel_download::state_path(&part_path));
    if part_path.exists() {
        let _ = std::fs::remove_file(part_path);
    }
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }

    if let (Some(parent), Some(file_stem)) = (path.parent(), path.file_stem()) {
        if let Some(stem_str) = file_stem.to_str() {
            if let Ok(entries) = std::fs::read_dir(parent) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.starts_with(stem_str)
                            && (name.ends_with(".vtt") || name.ends_with(".srt"))
                        {
                            let _ = std::fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }

        let base_path = Path::new(&base_dir);
        let mut directory = Some(parent);
        while let Some(current) = directory {
            if current == base_path || !current.starts_with(base_path) {
                break;
            }
            let is_empty = std::fs::read_dir(current)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);
            if !is_empty || std::fs::remove_dir(current).is_err() {
                break;
            }
            directory = current.parent();
        }
    }

    Ok(())
}

#[cfg(test)]
mod path_tests {
    use super::validate_download_path;

    fn test_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "vega-download-path-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn accepts_nested_path_below_download_root() {
        let root = test_root();
        let target = root.join("show").join("episode.mp4");

        let result = validate_download_path(root.to_str().unwrap(), target.to_str().unwrap());

        assert_eq!(result.unwrap(), target);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_path_outside_download_root() {
        let root = test_root();
        let outside = root.parent().unwrap().join("outside.mp4");

        let result = validate_download_path(root.to_str().unwrap(), outside.to_str().unwrap());

        assert!(result.is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}

fn sanitize_first_segment(data: &[u8]) -> (&[u8], bool) {
    // Check if it's already a valid MP4 (starts with ftyp or moov after 4 byte length)
    if data.len() >= 8 {
        let sig = &data[4..8];
        if sig == b"ftyp" || sig == b"moov" {
            return (data, true);
        }
    }

    // Check if it's MPEG-TS (starts with 0x47 and has another 0x47 188 bytes later)
    if data.len() > 188 && data[0] == 0x47 && data[188] == 0x47 {
        return (data, false);
    }

    // Otherwise, scan for the first valid MPEG-TS packet
    for i in 0..data.len() {
        if data[i] == 0x47 && i + 188 < data.len() && data[i + 188] == 0x47 {
            vlog_debug!("Stripped {} bytes of fake header from first segment", i);
            return (&data[i..], false);
        }
    }

    // Scan for MP4 ftyp just in case it's hidden
    for i in 0..data.len().saturating_sub(8) {
        let sig = &data[i + 4..i + 8];
        if sig == b"ftyp" || sig == b"moov" {
            vlog_debug!(
                "Stripped {} bytes of fake header from first segment (found MP4)",
                i
            );
            return (&data[i..], true);
        }
    }

    // Fallback: return as is
    (data, false)
}

pub async fn download_m3u8(
    app: AppHandle,
    state: State<'_, DownloadState>,
    id: String,
    url: String,
    file_path: String,
    client: Client,
    connections: usize,
) -> Result<(), String> {
    use url::Url;
    let mut current_url = url.clone();
    let mut playlist_text = client
        .get(&current_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let mut parsed = m3u8_rs::parse_playlist_res(playlist_text.as_bytes())
        .map_err(|_| "Failed to parse m3u8")?;

    if let m3u8_rs::Playlist::MasterPlaylist(master) = parsed {
        let variant = master
            .variants
            .iter()
            .max_by_key(|v| v.bandwidth)
            .ok_or("Master playlist has no variants")?;

        let base_url = Url::parse(&current_url).map_err(|e| e.to_string())?;
        let next_url = base_url.join(&variant.uri).map_err(|e| e.to_string())?;
        current_url = next_url.to_string();
        playlist_text = client
            .get(&current_url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        parsed = m3u8_rs::parse_playlist_res(playlist_text.as_bytes())
            .map_err(|_| "Failed to parse media playlist")?;
    }

    let media_playlist = match parsed {
        m3u8_rs::Playlist::MediaPlaylist(p) => p,
        _ => return Err("Not a media playlist".into()),
    };

    let path = PathBuf::from(&file_path);
    let part_path = path.with_extension("part");
    if let Some(parent) = part_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut open_opts = OpenOptions::new();
    open_opts.create(true).write(true).truncate(true);
    let mut dest = open_opts.open(&part_path).map_err(|e| e.to_string())?;

    let (cancel_tx, mut cancel_rx) = mpsc::channel::<()>(1);
    {
        let mut active = state.active_downloads.lock().await;
        active.insert(id.clone(), cancel_tx);
    }

    let base_url = Url::parse(&current_url).map_err(|e| e.to_string())?;
    let total_segments = media_playlist.segments.len() as u64;

    // Resolve every segment's URL and key first, so segments can download in
    // parallel while decryption and writing stay in playlist order.
    let mut jobs = Vec::with_capacity(media_playlist.segments.len());
    let mut current_key: Option<(Url, Option<Vec<u8>>)> = None;
    for (i, segment) in media_playlist.segments.iter().enumerate() {
        if let Some(key_info) = &segment.key {
            if key_info.method == m3u8_rs::KeyMethod::AES128 {
                if let Some(uri) = &key_info.uri {
                    let key_url = base_url.join(uri).map_err(|e| e.to_string())?;
                    let iv = match &key_info.iv {
                        Some(iv_hex) => Some(
                            hex::decode(iv_hex.trim_start_matches("0x").trim_start_matches("0X"))
                                .map_err(|e| e.to_string())?,
                        ),
                        None => None,
                    };
                    current_key = Some((key_url, iv));
                }
            } else if key_info.method == m3u8_rs::KeyMethod::None {
                current_key = None;
            }
        }
        // Without an explicit IV, each segment's IV is its media sequence number.
        let key = current_key.as_ref().map(|(key_url, iv)| {
            let iv = iv.clone().unwrap_or_else(|| {
                let seq = media_playlist.media_sequence + i as u64;
                let mut iv = vec![0u8; 16];
                iv[8..16].copy_from_slice(&seq.to_be_bytes());
                iv
            });
            (key_url.clone(), iv)
        });
        let segment_url = base_url.join(&segment.uri).map_err(|e| e.to_string())?;
        jobs.push((segment_url, key));
    }

    let mut keys: HashMap<Url, Vec<u8>> = HashMap::new();
    for (_, key) in &jobs {
        if let Some((key_url, _)) = key {
            if !keys.contains_key(key_url) {
                let key_bytes = client
                    .get(key_url.clone())
                    .send()
                    .await
                    .map_err(|e| e.to_string())?
                    .bytes()
                    .await
                    .map_err(|e| e.to_string())?;
                keys.insert(key_url.clone(), key_bytes.to_vec());
            }
        }
    }

    let mut total_downloaded_bytes: u64 = 0;
    let mut is_fmp4 = false;

    // EXT-X-MAP (fMP4 init segment) goes before the first segment.
    if let Some(map) = media_playlist.segments.first().and_then(|s| s.map.as_ref()) {
        let map_url = base_url.join(&map.uri).map_err(|e| e.to_string())?;
        let init_data = client
            .get(map_url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;

        let is_valid_mp4_init = init_data.len() >= 8
            && (&init_data[4..8] == b"ftyp" || &init_data[4..8] == b"moov");

        if is_valid_mp4_init {
            dest.write_all(&init_data).map_err(|e| e.to_string())?;
            total_downloaded_bytes += init_data.len() as u64;
            is_fmp4 = true;
        } else {
            vlog_debug!(
                "Discarding invalid/fake EXT-X-MAP segment of {} bytes",
                init_data.len()
            );
        }
    }

    let limiter = Arc::new(SegmentLimiter::new(connections));
    let received = Arc::new(AtomicU64::new(total_downloaded_bytes));
    let mut results = Box::pin(
        futures_util::stream::iter(jobs)
            .map(|(segment_url, key)| {
                let client = client.clone();
                let limiter = Arc::clone(&limiter);
                let received = Arc::clone(&received);
                async move {
                    fetch_segment(&client, segment_url, &limiter, &received)
                        .await
                        .map(|data| (data, key))
                }
            })
            .buffered(connections),
    );

    let mut downloaded_segments: u64 = 0;
    let mut previous_bytes = total_downloaded_bytes;
    let mut previous_time = std::time::Instant::now();
    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(500));
    loop {
        let next = tokio::select! {
            next = results.next() => next,
            _ = cancel_rx.recv() => {
                vlog_debug!("M3U8 Download paused/cancelled: {}", id);
                return Ok(());
            }
            _ = ticker.tick() => {
                let downloaded = received.load(Ordering::Relaxed);
                let elapsed = previous_time.elapsed().as_secs_f64().max(0.001);
                let estimated_total = (downloaded / downloaded_segments.max(1)) * total_segments;
                let _ = app.emit(
                    "download-progress",
                    ProgressPayload {
                        id: id.clone(),
                        downloaded,
                        total: estimated_total.max(downloaded),
                        speed: (downloaded.saturating_sub(previous_bytes) as f64 / elapsed) as u64,
                        details: None,
                    },
                );
                previous_bytes = downloaded;
                previous_time = std::time::Instant::now();
                continue;
            }
        };
        let Some(result) = next else {
            break;
        };
        let (seg_data, key) = result?;

        let mut final_data: &[u8] = &seg_data;
        let decrypted_vec;

        if let Some((key_url, iv)) = &key {
            use aes::cipher::{block_padding::Pkcs7, BlockModeDecrypt, KeyIvInit};
            type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

            let key = keys.get(key_url).ok_or("Missing segment key")?;
            let mut pt = seg_data.clone();

            let key_arr: &[u8; 16] = key
                .get(0..16)
                .and_then(|k| k.try_into().ok())
                .ok_or("Invalid key length")?;
            let iv_arr: &[u8; 16] = iv
                .get(0..16)
                .and_then(|v| v.try_into().ok())
                .ok_or("Invalid IV length")?;

            decrypted_vec = Aes128CbcDec::new(key_arr.into(), iv_arr.into())
                .decrypt_padded::<Pkcs7>(&mut pt)
                .map_err(|e| e.to_string())?
                .to_vec();
            final_data = &decrypted_vec;
        }

        if downloaded_segments == 0 && !is_fmp4 {
            let (sanitized, detected_fmp4) = sanitize_first_segment(final_data);
            final_data = sanitized;
            if detected_fmp4 {
                is_fmp4 = true;
            }
        }

        dest.write_all(final_data).map_err(|e| e.to_string())?;

        downloaded_segments += 1;
    }

    {
        let mut active = state.active_downloads.lock().await;
        active.remove(&id);
    }

    // Determine the correct extension based on whether a VALID init segment was found
    // If valid init segment exists, it's fMP4 (needs .mp4), otherwise it's MPEG-TS (needs .ts)
    let final_ext = if is_fmp4 { "mp4" } else { "ts" };
    let final_path = path.with_extension(final_ext);

    std::fs::rename(&part_path, &final_path).map_err(|e| e.to_string())?;
    let _ = app.emit(
        "download-complete",
        CompletePayload {
            id: id.clone(),
            final_path: final_path.to_string_lossy().to_string(),
        },
    );

    Ok(())
}

const MAX_SEGMENT_ATTEMPTS: u32 = 5;
const SEGMENT_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Caps the segments downloading at once. Each 429 or 503 removes one slot,
/// so a server that limits connections gets fewer of them.
struct SegmentLimiter {
    semaphore: Arc<Semaphore>,
    slots: AtomicUsize,
}

impl SegmentLimiter {
    fn new(slots: usize) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(slots)),
            slots: AtomicUsize::new(slots),
        }
    }

    /// Takes one slot away unless only one is left.
    fn shrink(&self) -> bool {
        self.slots
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |slots| {
                (slots > 1).then(|| slots - 1)
            })
            .is_ok()
    }
}

enum SegmentError {
    Status(reqwest::StatusCode),
    Network(String),
}

async fn fetch_segment(
    client: &Client,
    url: url::Url,
    limiter: &SegmentLimiter,
    received: &AtomicU64,
) -> Result<Vec<u8>, String> {
    for attempt in 1..=MAX_SEGMENT_ATTEMPTS {
        let permit = Arc::clone(&limiter.semaphore)
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;
        let mut counted = 0u64;
        let result = async {
            let mut response = client
                .get(url.clone())
                .send()
                .await
                .map_err(|e| SegmentError::Network(e.to_string()))?;
            if !response.status().is_success() {
                return Err(SegmentError::Status(response.status()));
            }
            let mut data = Vec::new();
            loop {
                let chunk = tokio::time::timeout(SEGMENT_READ_TIMEOUT, response.chunk())
                    .await
                    .map_err(|_| SegmentError::Network("Read timed out".into()))?
                    .map_err(|e| SegmentError::Network(e.to_string()))?;
                let Some(chunk) = chunk else {
                    return Ok(data);
                };
                data.extend_from_slice(&chunk);
                counted += chunk.len() as u64;
                received.fetch_add(chunk.len() as u64, Ordering::Relaxed);
            }
        }
        .await;

        let error = match result {
            Ok(data) => return Ok(data),
            Err(error) => error,
        };
        received.fetch_sub(counted, Ordering::Relaxed);
        let (message, rate_limited, permanent) = match &error {
            SegmentError::Status(status) => {
                let rate_limited = *status == reqwest::StatusCode::TOO_MANY_REQUESTS
                    || *status == reqwest::StatusCode::SERVICE_UNAVAILABLE;
                let permanent = status.is_client_error()
                    && *status != reqwest::StatusCode::REQUEST_TIMEOUT
                    && !rate_limited;
                (format!("Failed to download segment: {status}"), rate_limited, permanent)
            }
            SegmentError::Network(message) => (message.clone(), false, false),
        };
        if rate_limited && limiter.shrink() {
            permit.forget();
        } else {
            drop(permit);
        }
        if permanent || attempt == MAX_SEGMENT_ATTEMPTS {
            return Err(message);
        }
        let backoff = std::time::Duration::from_secs(1 << (attempt - 1).min(4));
        tokio::time::sleep(backoff).await;
    }
    unreachable!("the last attempt returns")
}

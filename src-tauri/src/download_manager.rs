use futures_util::StreamExt;
use reqwest::header::RANGE;
use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc::{self, Sender};
use tokio::sync::Mutex;

#[derive(Clone, Serialize)]
pub struct ProgressPayload {
    pub id: String,
    pub downloaded: u64,
    pub total: u64,
    pub speed: u64, // bytes per second
}

#[derive(Clone, Serialize)]
pub struct CompletePayload {
    pub id: String,
    pub final_path: String,
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

fn validate_download_path(base_dir: &str, file_path: &str) -> Result<PathBuf, String> {
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
    let canonical_ancestor =
        std::fs::canonicalize(existing_ancestor).map_err(|e| e.to_string())?;
    if !canonical_ancestor.starts_with(&canonical_base) {
        return Err("Download path escapes the configured directory".into());
    }

    Ok(target)
}

#[tauri::command]
pub async fn save_subtitle(base_dir: String, path: String, content: String) -> Result<(), String> {
    let path = validate_download_path(&base_dir, &path)?;
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("srt") || extension.eq_ignore_ascii_case("vtt") => {}
        _ => return Err("Unsupported subtitle file extension".into()),
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, content).map_err(|e| e.to_string())
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
) -> Result<(), String> {
    let path = validate_download_path(&base_dir, &file_path)?;
    let mut client_builder = Client::builder()
        .danger_accept_invalid_certs(true); // For scraping generic streams
        
    if let Some(h) = headers {
        let mut header_map = reqwest::header::HeaderMap::new();
        for (k, v) in h {
            if let (Ok(name), Ok(value)) = (reqwest::header::HeaderName::from_bytes(k.as_bytes()), reqwest::header::HeaderValue::from_str(&v)) {
                header_map.insert(name, value);
            }
        }
        client_builder = client_builder.default_headers(header_map);
    }
        
    let client = client_builder
        .build()
        .map_err(|e| e.to_string())?;

    if url.contains(".m3u8") || video_type.as_deref() == Some("m3u8") {
        return download_m3u8(app, state, id, url, file_path, client).await;
    }

    let part_path = path.with_extension("part");

    // Ensure parent directory exists
    if let Some(parent) = part_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Check if part file exists to get starting byte
    let mut start_byte = 0;
    if let Ok(metadata) = std::fs::metadata(&part_path) {
        start_byte = metadata.len();
    }

    let req = client.get(&url);
    let req = if start_byte > 0 {
        req.header(RANGE, format!("bytes={}-", start_byte))
    } else {
        req
    };

    let response = req.send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Server returned error: {}", response.status()));
    }
    
    // Check Content-Type to see if it's actually an m3u8 stream even if the URL doesn't have .m3u8
    if let Some(content_type) = response.headers().get(reqwest::header::CONTENT_TYPE) {
        if let Ok(ct_str) = content_type.to_str() {
            let ct_lower = ct_str.to_lowercase();
            if ct_lower.contains("mpegurl") || ct_lower.contains("mpegurl") || ct_lower.contains("application/x-mpegurl") || ct_lower.contains("application/vnd.apple.mpegurl") {
                return download_m3u8(app, state, id, url, file_path, client).await;
            }
        }
    }

    let total_size = response
        .content_length()
        .unwrap_or(0)
        .saturating_add(start_byte);

    let mut open_opts = OpenOptions::new();
    open_opts.create(true);
    if start_byte == 0 {
        open_opts.write(true).truncate(true);
    } else {
        open_opts.append(true);
    }
    
    let mut dest = open_opts.open(&part_path).map_err(|e| e.to_string())?;

    let (cancel_tx, mut cancel_rx) = mpsc::channel::<()>(1);

    {
        let mut active = state.active_downloads.lock().await;
        active.insert(id.clone(), cancel_tx);
    }

    let mut stream = response.bytes_stream();
    let mut downloaded = start_byte;
    let mut last_emit = std::time::Instant::now();
    let mut speed_tracker = std::time::Instant::now();
    let mut bytes_since_last_speed_check = 0;

    while let Some(chunk) = stream.next().await {
        // Check for cancellation
        if cancel_rx.try_recv().is_ok() {
            println!("Download paused: {}", id);
            return Ok(());
        }

        let chunk = chunk.map_err(|e| e.to_string())?;
        dest.write_all(&chunk).map_err(|e| e.to_string())?;

        let chunk_len = chunk.len() as u64;
        downloaded += chunk_len;
        bytes_since_last_speed_check += chunk_len;

        if last_emit.elapsed().as_millis() > 500 {
            let speed = (bytes_since_last_speed_check as f64
                / speed_tracker.elapsed().as_secs_f64()) as u64;
            let _ = app.emit(
                "download-progress",
                ProgressPayload {
                    id: id.clone(),
                    downloaded,
                    total: total_size,
                    speed,
                },
            );

            last_emit = std::time::Instant::now();
            speed_tracker = std::time::Instant::now();
            bytes_since_last_speed_check = 0;
        }
    }

    // Finished!
    {
        let mut active = state.active_downloads.lock().await;
        active.remove(&id);
    }

    // Rename .part to final
    std::fs::rename(&part_path, &path).map_err(|e| e.to_string())?;

    let _ = app.emit("download-complete", CompletePayload {
        id: id.clone(),
        final_path: file_path.clone(),
    });

    Ok(())
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
                        if name.starts_with(stem_str) && (name.ends_with(".vtt") || name.ends_with(".srt")) {
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

        let result = validate_download_path(
            root.to_str().unwrap(),
            target.to_str().unwrap(),
        );

        assert_eq!(result.unwrap(), target);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_path_outside_download_root() {
        let root = test_root();
        let outside = root.parent().unwrap().join("outside.mp4");

        let result = validate_download_path(
            root.to_str().unwrap(),
            outside.to_str().unwrap(),
        );

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
            println!("Stripped {} bytes of fake header from first segment", i);
            return (&data[i..], false);
        }
    }
    
    // Scan for MP4 ftyp just in case it's hidden
    for i in 0..data.len().saturating_sub(8) {
        let sig = &data[i+4..i+8];
        if sig == b"ftyp" || sig == b"moov" {
            println!("Stripped {} bytes of fake header from first segment (found MP4)", i);
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
) -> Result<(), String> {
    use url::Url;
    let mut current_url = url.clone();
    let mut playlist_text = client.get(&current_url).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    
    let mut parsed = m3u8_rs::parse_playlist_res(playlist_text.as_bytes()).map_err(|_| "Failed to parse m3u8")?;
    
    if let m3u8_rs::Playlist::MasterPlaylist(master) = parsed {
        let variant = master.variants.iter()
            .max_by_key(|v| v.bandwidth)
            .ok_or("Master playlist has no variants")?;
        
        let base_url = Url::parse(&current_url).map_err(|e| e.to_string())?;
        let next_url = base_url.join(&variant.uri).map_err(|e| e.to_string())?;
        current_url = next_url.to_string();
        playlist_text = client.get(&current_url).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
        parsed = m3u8_rs::parse_playlist_res(playlist_text.as_bytes()).map_err(|_| "Failed to parse media playlist")?;
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
    let mut downloaded_segments: u64 = 0;
    
    let mut last_emit = std::time::Instant::now();
    let mut speed_tracker = std::time::Instant::now();
    let mut bytes_since_last_speed_check: u64 = 0;
    let mut total_downloaded_bytes: u64 = 0;
    
    let mut current_key: Option<Vec<u8>> = None;
    let mut current_iv: Option<Vec<u8>> = None;
    let mut init_segment_written = false;
    let mut is_fmp4 = false;
    
    #[allow(clippy::explicit_counter_loop)]
    for (i, segment) in media_playlist.segments.iter().enumerate() {
        if cancel_rx.try_recv().is_ok() {
            println!("M3U8 Download paused/cancelled: {}", id);
            return Ok(());
        }

        // Handle EXT-X-MAP (fMP4 init segment) — write it once before the first segment
        if !init_segment_written {
            if let Some(map) = &segment.map {
                let map_url = base_url.join(&map.uri).map_err(|e| e.to_string())?;
                let init_data = client.get(map_url).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
                
                let is_valid_mp4_init = init_data.len() >= 8 && (&init_data[4..8] == b"ftyp" || &init_data[4..8] == b"moov");
                
                if is_valid_mp4_init {
                    dest.write_all(&init_data).map_err(|e| e.to_string())?;
                    total_downloaded_bytes += init_data.len() as u64;
                    is_fmp4 = true;
                } else {
                    println!("Discarding invalid/fake EXT-X-MAP segment of {} bytes", init_data.len());
                }
            }
            init_segment_written = true;
        }
        
        if let Some(key_info) = &segment.key {
            if key_info.method == m3u8_rs::KeyMethod::AES128 {
                if let Some(uri) = &key_info.uri {
                    let key_url = base_url.join(uri).map_err(|e| e.to_string())?;
                    let key_bytes = client.get(key_url).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
                    current_key = Some(key_bytes.to_vec());
                    
                    if let Some(iv_hex) = &key_info.iv {
                        let iv_clean = iv_hex.trim_start_matches("0x");
                        let iv_bytes = hex::decode(iv_clean).map_err(|e| e.to_string())?;
                        current_iv = Some(iv_bytes);
                    } else {
                        let seq = media_playlist.media_sequence + i as u64;
                        let mut iv = vec![0u8; 16];
                        iv[8..16].copy_from_slice(&seq.to_be_bytes());
                        current_iv = Some(iv);
                    }
                }
            } else if key_info.method == m3u8_rs::KeyMethod::None {
                current_key = None;
                current_iv = None;
            }
        }
        
        let seg_url = base_url.join(&segment.uri).map_err(|e| e.to_string())?;
        
        let mut seg_resp = client.get(seg_url).send().await.map_err(|e| e.to_string())?;
        if !seg_resp.status().is_success() {
            return Err(format!("Failed to download segment: {}", seg_resp.status()));
        }
        
        let mut seg_data = Vec::new();
        while let Some(chunk) = seg_resp.chunk().await.map_err(|e| e.to_string())? {
            seg_data.extend_from_slice(&chunk);
            bytes_since_last_speed_check += chunk.len() as u64;
            total_downloaded_bytes += chunk.len() as u64;
            
            if last_emit.elapsed().as_millis() > 500 {
                let speed = (bytes_since_last_speed_check as f64 / speed_tracker.elapsed().as_secs_f64()) as u64;
                let estimated_total = (total_downloaded_bytes / downloaded_segments.max(1)) * total_segments;
                
                let _ = app.emit(
                    "download-progress",
                    ProgressPayload {
                        id: id.clone(),
                        downloaded: total_downloaded_bytes,
                        total: estimated_total.max(total_downloaded_bytes),
                        speed,
                    },
                );
                last_emit = std::time::Instant::now();
                speed_tracker = std::time::Instant::now();
                bytes_since_last_speed_check = 0;
            }
        }
        
        let mut final_data: &[u8] = &seg_data;
        let decrypted_vec;
        
        if let (Some(key), Some(iv)) = (&current_key, &current_iv) {
            use aes::cipher::{KeyIvInit, BlockModeDecrypt, block_padding::Pkcs7};
            type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;
            
            let mut pt = seg_data.clone();
            
            let key_arr: &[u8; 16] = key[0..16].try_into().map_err(|_| "Invalid key length")?;
            let iv_arr: &[u8; 16] = iv[0..16].try_into().map_err(|_| "Invalid IV length")?;
            
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
    let _ = app.emit("download-complete", CompletePayload {
        id: id.clone(),
        final_path: final_path.to_string_lossy().to_string(),
    });
    
    Ok(())
}

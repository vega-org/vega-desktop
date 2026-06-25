use futures_util::StreamExt;
use reqwest::header::RANGE;
use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
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

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, DownloadState>,
    id: String,
    url: String,
    file_path: String,
) -> Result<(), String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true) // For scraping generic streams
        .build()
        .map_err(|e| e.to_string())?;

    let path = PathBuf::from(&file_path);
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

    let _ = app.emit("download-complete", id.clone());

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
) -> Result<(), String> {
    // First pause it
    let mut active = state.active_downloads.lock().await;
    if let Some(tx) = active.remove(&id) {
        let _ = tx.send(()).await;
    }

    // Then delete the partial file
    let path = PathBuf::from(&file_path);
    let part_path = path.with_extension("part");
    if part_path.exists() {
        let _ = std::fs::remove_file(part_path);
    }
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }

    Ok(())
}

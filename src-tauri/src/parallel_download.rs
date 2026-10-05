//! Direct-file downloads over several connections, the way IDM does them.
//!
//! One connection starts at the first missing byte. Every free connection then
//! takes the second half of the largest range still downloading, so all
//! connections stay busy until the end. Many servers limit speed per
//! connection, so this multiplies the speed. Rate limits (429, 503, refused
//! connections) lower the connection count instead of failing the download.
//!
//! The missing ranges are saved next to the `.part` file, so a paused or
//! interrupted download continues where each range stopped.

use futures_util::StreamExt;
use reqwest::header::{CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_RANGE, LAST_MODIFIED, RANGE, RETRY_AFTER};
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Notify};
use tokio::task::JoinHandle;

/// Ranges still downloading and the connections on them, for the download
/// details view. Each range is [start, end, bytes per second, connection on it].
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDetails {
    pub ranges: Vec<(u64, u64, u64, bool)>,
    pub connections: usize,
    pub connection_limit: usize,
}

/// Receives (downloaded bytes, total bytes or 0 when unknown, bytes per second,
/// connection details).
pub type ProgressFn<'a> = &'a (dyn Fn(u64, u64, u64, Option<ConnectionDetails>) + Send + Sync);

/// Upper bound for the connection setting.
pub const MAX_CONNECTIONS: usize = 16;
/// A range is split only when both halves get at least this much.
const MIN_SPLIT_BYTES: u64 = 2 * 1024 * 1024;
/// Long requests keep the request count low; the cap limits what a dropped
/// connection costs on servers that cut long transfers.
const MAX_REQUEST_BYTES: u64 = 256 * 1024 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(500);
const PERSIST_INTERVAL: Duration = Duration::from_secs(2);
const CONNECTION_GROW_INTERVAL: Duration = Duration::from_secs(30);
const SEGMENT_RETRY_DELAY: Duration = Duration::from_secs(1);
const INITIAL_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const MAX_RETRY_AFTER: Duration = Duration::from_secs(60);
/// A rate limit this long after the previous wait counts as a new one.
const RATE_LIMIT_RESET: Duration = Duration::from_secs(10);
const STALL_TIMEOUT: Duration = Duration::from_secs(30);
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_RESTARTS: usize = 3;

pub enum Outcome {
    Completed,
    Paused,
    /// The URL serves an HLS playlist; the caller downloads it as one.
    Playlist,
}

#[derive(Serialize, Deserialize)]
struct ResumeState {
    url: String,
    total: u64,
    validator: Option<String>,
    remaining: Vec<(u64, u64)>,
}

struct Segment {
    id: u64,
    pos: u64,
    /// Exclusive. `u64::MAX` when the size is unknown.
    end: u64,
    owned: bool,
    not_before: Instant,
    received_since_report: u64,
}

impl Segment {
    fn remaining(&self) -> u64 {
        self.end - self.pos
    }
}

struct Shared {
    segments: Vec<Segment>,
    next_id: u64,
    active: usize,
    max_connections: usize,
    cooldown_until: Instant,
    grow_at: Option<Instant>,
    rate_limit_streak: u32,
    /// Connections currently receiving data: what the server accepts right now.
    streaming: usize,
    fatal: Option<String>,
    restart: bool,
    last_error: Option<String>,
    last_progress: Instant,
    downloaded: u64,
}

struct Transfer {
    client: Client,
    url: String,
    file: File,
    total: u64,
    splittable: bool,
    /// Connections the user allows; rate limits lower the working count below it.
    connection_limit: usize,
    validator: Option<String>,
    shared: Mutex<Shared>,
    wake: Notify,
}

enum WorkerError {
    Status(StatusCode, Option<Duration>),
    /// The file changed on the server or a range came back wrong.
    Restart(String),
    Destination(String),
    Network(String),
}

pub fn state_path(part_path: &Path) -> PathBuf {
    let mut name = part_path.as_os_str().to_owned();
    name.push(".state");
    PathBuf::from(name)
}

pub async fn download(
    on_progress: ProgressFn<'_>,
    client: &Client,
    url: &str,
    part_path: &Path,
    connections: usize,
    cancel_rx: &mut mpsc::Receiver<()>,
) -> Result<Outcome, String> {
    let connections = connections.clamp(1, MAX_CONNECTIONS);
    let state_file = state_path(part_path);
    for _ in 0..MAX_RESTARTS {
        let file_len = std::fs::metadata(part_path).map(|m| m.len()).unwrap_or(0);
        let saved = read_state(&state_file)
            .filter(|state| state.url == url && state.total > 0)
            .filter(|state| !state.remaining.is_empty() || file_len >= state.total)
            // The partial file was removed; the saved ranges no longer describe it.
            .filter(|state| !(file_len == 0 && remaining_bytes(&state.remaining) < state.total));
        if let Some(state) = &saved {
            if state.remaining.is_empty() && file_len >= state.total {
                let _ = std::fs::remove_file(&state_file);
                return Ok(Outcome::Completed);
            }
        }

        // Without saved ranges the file is contiguous from byte 0: a fresh
        // download, or one started by the single-connection version.
        let probe_start = saved
            .as_ref()
            .and_then(|state| state.remaining.first().map(|range| range.0))
            .unwrap_or(file_len);
        let validator = saved.as_ref().and_then(|state| state.validator.clone());
        let mut request = client.get(url).header(RANGE, format!("bytes={probe_start}-"));
        if probe_start > 0 || saved.is_some() {
            if let Some(value) = &validator {
                request = request.header(IF_RANGE, value);
            }
        }
        let response = tokio::select! {
            result = request.send() => result.map_err(|e| e.to_string())?,
            _ = cancel_rx.recv() => return Ok(Outcome::Paused),
        };

        let status = response.status();
        if status == StatusCode::RANGE_NOT_SATISFIABLE {
            let (_, total) = parse_content_range(&response);
            if saved.is_none() && total == Some(file_len) {
                return Ok(Outcome::Completed);
            }
            reset_files(part_path, &state_file)?;
            continue;
        }
        if !status.is_success() {
            return Err(format!("Server returned error: {status}"));
        }
        if is_playlist(&response) {
            return Ok(Outcome::Playlist);
        }

        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .open(part_path)
            .map_err(|e| e.to_string())?;
        mark_sparse(&file);

        let (ranges, total, splittable) = if status == StatusCode::PARTIAL_CONTENT {
            let (start, total) = parse_content_range(&response);
            if start != Some(probe_start)
                || saved.as_ref().is_some_and(|state| total != Some(state.total))
            {
                drop(file);
                reset_files(part_path, &state_file)?;
                continue;
            }
            match (total, saved) {
                (Some(total), Some(state)) if total > 0 => (state.remaining, total, true),
                (Some(total), None) if total > 0 => (vec![(probe_start, total)], total, true),
                // Size unknown: keep one connection and read to the end.
                _ => (vec![(probe_start, u64::MAX)], 0, false),
            }
        } else {
            // The server ignored Range or the validator changed. Never append a
            // full response to a partial file because that corrupts the video.
            file.set_len(0).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&state_file);
            let length = response.content_length().unwrap_or(0);
            let end = if length > 0 { length } else { u64::MAX };
            (vec![(0, end)], length, false)
        };

        let response_validator = header_string(&response, ETAG)
            .or_else(|| header_string(&response, LAST_MODIFIED));
        let now = Instant::now();
        let segments: Vec<Segment> = ranges
            .iter()
            .enumerate()
            .map(|(index, &(pos, end))| Segment {
                id: index as u64,
                pos,
                end,
                owned: false,
                not_before: now,
                received_since_report: 0,
            })
            .collect();
        let downloaded = if total > 0 {
            total - remaining_bytes(&ranges)
        } else {
            ranges[0].0
        };
        let transfer = Arc::new(Transfer {
            client: client.clone(),
            url: url.to_string(),
            file,
            total,
            splittable,
            connection_limit: if splittable { connections } else { 1 },
            validator: if splittable {
                response_validator.or(validator)
            } else {
                None
            },
            shared: Mutex::new(Shared {
                next_id: segments.len() as u64,
                segments,
                active: 0,
                max_connections: if splittable { connections } else { 1 },
                cooldown_until: now,
                grow_at: None,
                rate_limit_streak: 0,
                streaming: 0,
                fatal: None,
                restart: false,
                last_error: None,
                last_progress: now,
                downloaded,
            }),
            wake: Notify::new(),
        });

        let result = run(on_progress, &transfer, &state_file, response, cancel_rx).await;
        match result {
            RunResult::Completed => {
                transfer.file.sync_all().map_err(|e| e.to_string())?;
                drop(transfer);
                let _ = std::fs::remove_file(&state_file);
                return Ok(Outcome::Completed);
            }
            RunResult::Paused => return Ok(Outcome::Paused),
            RunResult::Failed(message) => return Err(message),
            RunResult::Restart => {
                drop(transfer);
                reset_files(part_path, &state_file)?;
            }
        }
    }
    Err("The server kept returning invalid byte ranges".into())
}

enum RunResult {
    Completed,
    Paused,
    Failed(String),
    Restart,
}

async fn run(
    on_progress: ProgressFn<'_>,
    transfer: &Arc<Transfer>,
    state_file: &Path,
    probe: Response,
    cancel_rx: &mut mpsc::Receiver<()>,
) -> RunResult {
    let mut handles: Vec<JoinHandle<()>> = Vec::new();
    {
        let mut shared = transfer.shared.lock().unwrap();
        let first = shared.segments[0].id;
        handles.push(start_worker(transfer, &mut shared, first, Some(probe)));
    }

    let mut previous_bytes = transfer.shared.lock().unwrap().downloaded;
    let mut previous_time = Instant::now();
    let mut last_persist = Instant::now();
    let result = loop {
        tokio::select! {
            _ = cancel_rx.recv() => break RunResult::Paused,
            _ = transfer.wake.notified() => {}
            _ = tokio::time::sleep(Duration::from_millis(250)) => {}
        }

        {
            let mut shared = transfer.shared.lock().unwrap();
            if shared.restart {
                break RunResult::Restart;
            }
            if let Some(message) = shared.fatal.take() {
                break RunResult::Failed(message);
            }
            if shared.segments.is_empty() && shared.active == 0 {
                break RunResult::Completed;
            }
            if let Some(error) = &shared.last_error {
                if shared.last_progress.elapsed() >= STALL_TIMEOUT {
                    break RunResult::Failed(error.clone());
                }
            }
            handles.retain(|handle| !handle.is_finished());
            handles.extend(schedule(transfer, &mut shared));
        }

        let now = Instant::now();
        let elapsed = now - previous_time;
        if elapsed >= PROGRESS_INTERVAL {
            let (downloaded, details) = {
                let mut shared = transfer.shared.lock().unwrap();
                (shared.downloaded, connection_details(&mut shared, elapsed))
            };
            let speed = (downloaded - previous_bytes) as f64 / elapsed.as_secs_f64();
            on_progress(downloaded, transfer.total, speed as u64, details);
            previous_bytes = downloaded;
            previous_time = now;
        }
        if now - last_persist >= PERSIST_INTERVAL {
            persist(transfer, state_file);
            last_persist = now;
        }
    };

    // Workers write between await points, so aborting never cuts a write.
    for handle in &handles {
        handle.abort();
    }
    for handle in handles {
        let _ = handle.await;
    }
    persist(transfer, state_file);
    let downloaded = transfer.shared.lock().unwrap().downloaded;
    on_progress(downloaded, transfer.total, 0, None);
    result
}

fn connection_details(shared: &mut Shared, elapsed: Duration) -> Option<ConnectionDetails> {
    let seconds = elapsed.as_secs_f64().max(0.001);
    let mut ranges = Vec::new();
    for segment in shared.segments.iter_mut() {
        if segment.remaining() == 0 || segment.end == u64::MAX {
            continue;
        }
        let speed = (segment.received_since_report as f64 / seconds) as u64;
        segment.received_since_report = 0;
        ranges.push((segment.pos, segment.end, speed, segment.owned));
    }
    if ranges.is_empty() {
        return None;
    }
    Some(ConnectionDetails {
        ranges,
        connections: shared.streaming,
        connection_limit: shared.max_connections,
    })
}

/// Fills free connection slots.
fn schedule(transfer: &Arc<Transfer>, shared: &mut Shared) -> Vec<JoinHandle<()>> {
    let mut started = Vec::new();
    let now = Instant::now();
    if shared.grow_at.is_some_and(|at| now >= at) && shared.max_connections < transfer.connection_limit {
        shared.max_connections += 1;
        shared.grow_at = (shared.max_connections < transfer.connection_limit).then(|| now + CONNECTION_GROW_INTERVAL);
    }
    if now < shared.cooldown_until {
        return started;
    }
    while shared.active < shared.max_connections {
        if let Some(id) = shared
            .segments
            .iter()
            .find(|s| !s.owned && s.remaining() > 0 && s.not_before <= now)
            .map(|s| s.id)
        {
            started.push(start_worker(transfer, shared, id, None));
            continue;
        }
        if !transfer.splittable {
            break;
        }
        let Some(index) = shared
            .segments
            .iter()
            .enumerate()
            .filter(|(_, s)| s.owned)
            .max_by_key(|(_, s)| s.remaining())
            .map(|(index, _)| index)
        else {
            break;
        };
        let largest = &mut shared.segments[index];
        if largest.remaining() < MIN_SPLIT_BYTES * 2 {
            break;
        }
        let middle = largest.pos + largest.remaining() / 2;
        let end = largest.end;
        largest.end = middle;
        let id = shared.next_id;
        shared.next_id += 1;
        shared.segments.insert(
            index + 1,
            Segment {
                id,
                pos: middle,
                end,
                owned: false,
                not_before: now,
                received_since_report: 0,
            },
        );
        started.push(start_worker(transfer, shared, id, None));
    }
    started
}

fn start_worker(
    transfer: &Arc<Transfer>,
    shared: &mut Shared,
    segment_id: u64,
    response: Option<Response>,
) -> JoinHandle<()> {
    if let Some(segment) = shared.segments.iter_mut().find(|s| s.id == segment_id) {
        segment.owned = true;
    }
    shared.active += 1;
    let transfer = Arc::clone(transfer);
    tokio::spawn(async move {
        let _guard = WorkerGuard {
            transfer: Arc::clone(&transfer),
            segment_id,
        };
        if let Err(error) = work(&transfer, segment_id, response).await {
            on_worker_error(&transfer, segment_id, error);
        }
    })
}

/// Releases the segment and the connection slot, also when the task is aborted.
struct WorkerGuard {
    transfer: Arc<Transfer>,
    segment_id: u64,
}

impl Drop for WorkerGuard {
    fn drop(&mut self) {
        if let Ok(mut shared) = self.transfer.shared.lock() {
            if let Some(segment) = shared.segments.iter_mut().find(|s| s.id == self.segment_id) {
                segment.owned = false;
            }
            shared.active = shared.active.saturating_sub(1);
        }
        self.transfer.wake.notify_one();
    }
}

fn segment_bounds(transfer: &Transfer, segment_id: u64) -> Option<(u64, u64)> {
    let shared = transfer.shared.lock().unwrap();
    shared
        .segments
        .iter()
        .find(|s| s.id == segment_id)
        .map(|s| (s.pos, s.end))
}

async fn work(
    transfer: &Transfer,
    segment_id: u64,
    mut response: Option<Response>,
) -> Result<(), WorkerError> {
    loop {
        let Some((pos, end)) = segment_bounds(transfer, segment_id) else {
            return Ok(());
        };
        if pos >= end {
            break;
        }
        let body = match response.take() {
            Some(body) => body,
            None => {
                let range = if end == u64::MAX {
                    format!("bytes={pos}-")
                } else {
                    format!("bytes={pos}-{}", end.min(pos + MAX_REQUEST_BYTES) - 1)
                };
                let mut request = transfer.client.get(&transfer.url).header(RANGE, range);
                if let Some(value) = &transfer.validator {
                    request = request.header(IF_RANGE, value);
                }
                let body = request
                    .send()
                    .await
                    .map_err(|e| WorkerError::Network(e.to_string()))?;
                check_range_response(transfer, &body, pos)?;
                body
            }
        };

        let streaming = Streaming::start(transfer);
        let reached_end = read_into(transfer, segment_id, body).await?;
        drop(streaming);
        if reached_end {
            continue;
        }
        // The body ended before the segment did.
        let advanced = segment_bounds(transfer, segment_id).is_some_and(|(now, _)| now > pos);
        if end == u64::MAX {
            let mut shared = transfer.shared.lock().unwrap();
            if let Some(segment) = shared.segments.iter_mut().find(|s| s.id == segment_id) {
                segment.end = segment.pos;
            }
        } else if !transfer.splittable || !advanced {
            return Err(WorkerError::Network(
                "Connection ended before the file was complete".into(),
            ));
        }
    }
    let mut shared = transfer.shared.lock().unwrap();
    shared.segments.retain(|s| s.id != segment_id);
    shared.last_error = None;
    Ok(())
}

/// Counts a connection in `Shared::streaming` while it receives data.
struct Streaming<'a>(&'a Transfer);

impl<'a> Streaming<'a> {
    fn start(transfer: &'a Transfer) -> Self {
        transfer.shared.lock().unwrap().streaming += 1;
        Self(transfer)
    }
}

impl Drop for Streaming<'_> {
    fn drop(&mut self) {
        if let Ok(mut shared) = self.0.shared.lock() {
            shared.streaming = shared.streaming.saturating_sub(1);
        }
    }
}

fn check_range_response(transfer: &Transfer, response: &Response, pos: u64) -> Result<(), WorkerError> {
    let status = response.status();
    if !status.is_success() {
        return Err(WorkerError::Status(status, retry_after(response)));
    }
    let (start, total) = parse_content_range(response);
    if status != StatusCode::PARTIAL_CONTENT
        || start != Some(pos)
        || (transfer.total > 0 && total != Some(transfer.total))
    {
        return Err(WorkerError::Restart(
            "The file changed on the server; restarting".into(),
        ));
    }
    Ok(())
}

/// Returns true when the segment end was reached, false when the body ended first.
async fn read_into(transfer: &Transfer, segment_id: u64, response: Response) -> Result<bool, WorkerError> {
    let mut stream = response.bytes_stream();
    loop {
        let chunk = match tokio::time::timeout(READ_TIMEOUT, stream.next()).await {
            Err(_) => return Err(WorkerError::Network("Read timed out".into())),
            Ok(None) => return Ok(false),
            Ok(Some(Err(error))) => return Err(WorkerError::Network(error.to_string())),
            Ok(Some(Ok(chunk))) => chunk,
        };
        // No await from here to the position update: an abort never splits them.
        let Some((pos, end)) = segment_bounds(transfer, segment_id) else {
            return Ok(true);
        };
        let count = (chunk.len() as u64).min(end - pos) as usize;
        if count > 0 {
            write_at(&transfer.file, &chunk[..count], pos)
                .map_err(|e| WorkerError::Destination(format!("Unable to write the download: {e}")))?;
        }
        let mut shared = transfer.shared.lock().unwrap();
        shared.downloaded += count as u64;
        if count > 0 {
            shared.last_progress = Instant::now();
        }
        let Some(segment) = shared.segments.iter_mut().find(|s| s.id == segment_id) else {
            return Ok(true);
        };
        segment.pos += count as u64;
        segment.received_since_report += count as u64;
        if segment.pos >= segment.end {
            return Ok(true);
        }
    }
}

fn on_worker_error(transfer: &Transfer, segment_id: u64, error: WorkerError) {
    let mut shared = transfer.shared.lock().unwrap();
    let now = Instant::now();
    let mut retry_at = now + SEGMENT_RETRY_DELAY;
    match error {
        WorkerError::Restart(message) => {
            vlog_debug!("Download restarting: {}", message);
            shared.restart = true;
        }
        WorkerError::Destination(message) => shared.fatal = Some(message),
        WorkerError::Status(status, retry_after)
            if status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE =>
        {
            // The server refuses this many connections. Keep the ones it
            // accepts, wait, and let the count grow back slowly. Errors from a
            // burst of new connections count as one rate limit.
            if now >= shared.cooldown_until {
                if now >= shared.cooldown_until + RATE_LIMIT_RESET {
                    shared.rate_limit_streak = 0;
                }
                let backoff = (INITIAL_BACKOFF * 2u32.pow(shared.rate_limit_streak.min(5))).min(MAX_BACKOFF);
                shared.rate_limit_streak += 1;
                shared.cooldown_until = now + retry_after.unwrap_or(backoff);
            }
            shared.max_connections = shared.max_connections.min(shared.streaming.max(1));
            shared.grow_at = Some(shared.cooldown_until + CONNECTION_GROW_INTERVAL);
            retry_at = shared.cooldown_until;
            shared.last_error = Some(format!("Server returned error: {status}"));
        }
        WorkerError::Status(status, _)
            if status.is_client_error() && status != StatusCode::REQUEST_TIMEOUT =>
        {
            // With other connections working, an error here is most likely a
            // per-connection limit; only a single connection's error is final.
            if shared.streaming == 0 {
                shared.fatal = Some(format!("Server returned error: {status}"));
            } else {
                shared.max_connections = shared.max_connections.min(shared.streaming);
                shared.grow_at = Some(now + CONNECTION_GROW_INTERVAL);
                shared.last_error = Some(format!("Server returned error: {status}"));
            }
        }
        WorkerError::Status(status, _) => {
            shared.last_error = Some(format!("Server returned error: {status}"));
        }
        WorkerError::Network(message) => shared.last_error = Some(message),
    }
    if let Some(segment) = shared.segments.iter_mut().find(|s| s.id == segment_id) {
        segment.not_before = retry_at;
    }
}

fn persist(transfer: &Transfer, state_file: &Path) {
    if transfer.total == 0 {
        return;
    }
    let remaining = {
        let shared = transfer.shared.lock().unwrap();
        shared
            .segments
            .iter()
            .filter(|s| s.remaining() > 0)
            .map(|s| (s.pos, s.end))
            .collect::<Vec<_>>()
    };
    let state = ResumeState {
        url: transfer.url.clone(),
        total: transfer.total,
        validator: transfer.validator.clone(),
        remaining,
    };
    if let Ok(json) = serde_json::to_vec(&state) {
        let temp = state_file.with_extension("state.tmp");
        if std::fs::write(&temp, json).is_ok() {
            let _ = std::fs::rename(&temp, state_file);
        }
    }
}

fn read_state(path: &Path) -> Option<ResumeState> {
    let bytes = std::fs::read(path).ok()?;
    let mut state: ResumeState = serde_json::from_slice(&bytes).ok()?;
    if state.remaining.iter().any(|&(start, end)| end <= start || end > state.total) {
        return None;
    }
    state.remaining.sort_unstable();
    Some(state)
}

fn reset_files(part_path: &Path, state_file: &Path) -> Result<(), String> {
    let _ = std::fs::remove_file(state_file);
    if part_path.exists() {
        std::fs::remove_file(part_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn remaining_bytes(ranges: &[(u64, u64)]) -> u64 {
    ranges.iter().map(|&(start, end)| end.saturating_sub(start)).sum()
}

fn is_playlist(response: &Response) -> bool {
    header_string(response, CONTENT_TYPE)
        .is_some_and(|value| value.to_ascii_lowercase().contains("mpegurl"))
}

fn header_string(response: &Response, name: reqwest::header::HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

/// Start byte and total size from `Content-Range: bytes start-end/total`.
fn parse_content_range(response: &Response) -> (Option<u64>, Option<u64>) {
    let Some(value) = header_string(response, CONTENT_RANGE) else {
        return (None, None);
    };
    let Some(rest) = value.trim().strip_prefix("bytes") else {
        return (None, None);
    };
    let rest = rest.trim();
    let (range, total) = rest.split_once('/').unwrap_or((rest, ""));
    let start = range.split_once('-').and_then(|(start, _)| start.trim().parse().ok());
    (start, total.trim().parse().ok())
}

fn retry_after(response: &Response) -> Option<Duration> {
    let seconds: u64 = header_string(response, RETRY_AFTER)?.trim().parse().ok()?;
    Some(Duration::from_secs(seconds).min(MAX_RETRY_AFTER))
}

fn write_at(file: &File, mut buf: &[u8], mut offset: u64) -> std::io::Result<()> {
    while !buf.is_empty() {
        #[cfg(windows)]
        let written = std::os::windows::fs::FileExt::seek_write(file, buf, offset)?;
        #[cfg(unix)]
        let written = std::os::unix::fs::FileExt::write_at(file, buf, offset)?;
        if written == 0 {
            return Err(std::io::ErrorKind::WriteZero.into());
        }
        buf = &buf[written..];
        offset += written as u64;
    }
    Ok(())
}

/// Without this, NTFS fills the gap with zeros before the first write far into
/// the file, which stalls that connection for seconds on a large download.
/// Linux and macOS file systems leave gaps sparse on their own.
#[cfg(windows)]
fn mark_sparse(file: &File) {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Ioctl::FSCTL_SET_SPARSE;
    use windows::Win32::System::IO::DeviceIoControl;
    let mut returned = 0u32;
    // Fails on FAT/exFAT drives; the download then works as before, just slower to start.
    let _ = unsafe {
        DeviceIoControl(
            HANDLE(file.as_raw_handle()),
            FSCTL_SET_SPARSE,
            None,
            0,
            None,
            0,
            Some(&mut returned),
            None,
        )
    };
}

#[cfg(not(windows))]
fn mark_sparse(_file: &File) {}

#[cfg(test)]
#[path = "parallel_download_tests.rs"]
mod tests;

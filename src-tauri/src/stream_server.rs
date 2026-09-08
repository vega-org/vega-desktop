use axum::{
    body::{Body, Bytes},
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::stream;
use reqwest::Client;
use serde::Deserialize;
use std::{
    collections::HashMap,
    io::SeekFrom,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex},
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use tauri::Emitter;

use crate::ffmpeg_resolver;
use crate::media_probe;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RemuxStreamInfo {
    pub session_id: String,
    pub requested_start: f64,
    pub actual_start: f64,
    pub initial_skip: f64,
}

pub type LocalFileRegistry = Arc<Mutex<HashMap<String, PathBuf>>>;
pub type SessionRegistry = Arc<tokio::sync::Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>>;
pub type RemuxInfoRegistry = Arc<tokio::sync::Mutex<HashMap<String, RemuxStreamInfo>>>;

#[derive(Clone)]
pub struct ProxyState {
    pub client: Client,
    pub port: u16,
    pub local_files: LocalFileRegistry,
    pub sessions: SessionRegistry,
    pub remux_infos: RemuxInfoRegistry,
    pub app: Option<tauri::AppHandle>,
}

#[derive(Deserialize)]
pub struct ProxyQuery {
    url: String,
    #[serde(default)]
    referer: Option<String>,
    #[serde(default)]
    ua: Option<String>,
}

#[derive(Deserialize)]
pub struct SegmentQuery {
    url: String,
    #[serde(default)]
    referer: Option<String>,
    #[serde(default)]
    ua: Option<String>,
}

#[derive(Deserialize)]
pub struct RemuxQuery {
    url: String,
    #[serde(default)]
    start: Option<f64>,
    #[serde(default)]
    audio_index: Option<u32>,
    #[serde(default)]
    video_index: Option<u32>,
    #[serde(default)]
    audio_delay: Option<f64>,
    #[serde(default)]
    audio_codec: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    referer: Option<String>,
    #[serde(default)]
    ua: Option<String>,
    #[serde(default)]
    origin: Option<String>,
}

#[derive(Deserialize)]
pub struct ProbeQuery {
    url: String,
    #[serde(default)]
    referer: Option<String>,
    #[serde(default)]
    ua: Option<String>,
    #[serde(default)]
    origin: Option<String>,
}

#[derive(Deserialize)]
pub struct SubsQuery {
    url: String,
    sub_index: u32,
    #[serde(default)]
    referer: Option<String>,
    #[serde(default)]
    ua: Option<String>,
    #[serde(default)]
    origin: Option<String>,
}

#[derive(Deserialize)]
pub struct CancelQuery {
    session_id: String,
}

#[derive(Deserialize)]
pub struct RemuxInfoQuery {
    pub session_id: String,
}

async fn handle_remux_info(
    State(state): State<ProxyState>,
    Query(query): Query<RemuxInfoQuery>,
) -> Result<axum::Json<RemuxStreamInfo>, StatusCode> {
    let infos = state.remux_infos.lock().await;
    if let Some(info) = infos.get(&query.session_id) {
        Ok(axum::Json(info.clone()))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

pub async fn start_server(
    local_files: LocalFileRegistry,
    app_handle: Option<tauri::AppHandle>,
) -> Result<u16, String> {
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(10))
        .pool_idle_timeout(std::time::Duration::from_secs(20))
        .pool_max_idle_per_host(4)
        .build()
        .map_err(|e| e.to_string())?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    println!("[stream_proxy] Starting on port {}", port);

    let state = ProxyState {
        client,
        port,
        local_files,
        sessions: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        remux_infos: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        app: app_handle,
    };

    let app = Router::new()
        .route("/playlist.m3u8", get(handle_proxy))
        .route("/segment.ts", get(handle_segment))
        .route("/local/{token}/{file_name}", get(handle_local_file))
        .route("/file", get(handle_direct_file))
        .route("/remux", get(handle_remux))
        .route("/remux/info", get(handle_remux_info))
        .route("/remux/cancel", get(handle_cancel_remux))
        .route("/probe", get(handle_probe))
        .route("/subs", get(handle_subs))
        .with_state(state);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[stream_proxy] Server error: {}", e);
        }
    });

    Ok(port)
}

fn parse_byte_range(value: &str, file_size: u64) -> Result<(u64, u64), StatusCode> {
    let value = value
        .strip_prefix("bytes=")
        .ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?;
    if value.contains(',') || file_size == 0 {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }
    let (start, end) = value
        .split_once('-')
        .ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?;

    if start.is_empty() {
        let suffix = end
            .parse::<u64>()
            .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?;
        if suffix == 0 {
            return Err(StatusCode::RANGE_NOT_SATISFIABLE);
        }
        return Ok((file_size.saturating_sub(suffix), file_size - 1));
    }

    let start = start
        .parse::<u64>()
        .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?;
    let end = if end.is_empty() {
        file_size - 1
    } else {
        end.parse::<u64>()
            .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?
            .min(file_size - 1)
    };
    if start >= file_size || end < start {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }
    Ok((start, end))
}

async fn handle_local_file(
    State(state): State<ProxyState>,
    AxumPath((token, _file_name)): AxumPath<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let path = state
        .local_files
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .get(&token)
        .cloned()
        .ok_or(StatusCode::NOT_FOUND)?;
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let file_size = file
        .metadata()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .len();

    let requested_range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| parse_byte_range(value, file_size))
        .transpose()?;
    let (start, end, status) = match requested_range {
        Some((start, end)) => (start, end, StatusCode::PARTIAL_CONTENT),
        None if file_size > 0 => (0, file_size - 1, StatusCode::OK),
        None => (0, 0, StatusCode::OK),
    };
    let content_length = if file_size == 0 { 0 } else { end - start + 1 };

    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let body_stream =
        stream::try_unfold((file, content_length), |(mut file, remaining)| async move {
            if remaining == 0 {
                return Ok::<_, std::io::Error>(None);
            }
            let mut buffer = vec![0; remaining.min(64 * 1024) as usize];
            let read = file.read(&mut buffer).await?;
            if read == 0 {
                return Ok(None);
            }
            buffer.truncate(read);
            Ok(Some((
                Bytes::from(buffer),
                (file, remaining.saturating_sub(read as u64)),
            )))
        });

    let mut response = Response::builder()
        .status(status)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, content_length)
        .header(header::CONTENT_TYPE, "application/octet-stream");
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{file_size}"),
        );
    }
    response
        .body(Body::from_stream(body_stream))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
pub struct LocalDirectFileQuery {
    path: String,
}

async fn handle_direct_file(
    Query(query): Query<LocalDirectFileQuery>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let path = PathBuf::from(&query.path);
    if !path.is_file() {
        eprintln!("[stream_server] /file: not found: {:?}", path);
        return Err(StatusCode::NOT_FOUND);
    }
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let file_size = file
        .metadata()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .len();

    let requested_range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| parse_byte_range(value, file_size))
        .transpose()?;
    let (start, end, status) = match requested_range {
        Some((start, end)) => (start, end, StatusCode::PARTIAL_CONTENT),
        None if file_size > 0 => (0, file_size - 1, StatusCode::OK),
        None => (0, 0, StatusCode::OK),
    };
    let content_length = if file_size == 0 { 0 } else { end - start + 1 };

    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let body_stream =
        stream::try_unfold((file, content_length), |(mut file, remaining)| async move {
            if remaining == 0 {
                return Ok::<_, std::io::Error>(None);
            }
            let mut buffer = vec![0; remaining.min(64 * 1024) as usize];
            let read = file.read(&mut buffer).await?;
            if read == 0 {
                return Ok(None);
            }
            buffer.truncate(read);
            Ok(Some((
                Bytes::from(buffer),
                (file, remaining.saturating_sub(read as u64)),
            )))
        });

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let content_type = match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        _ => "video/mp4",
    };

    let mut response = Response::builder()
        .status(status)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, content_length)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::HeaderName::from_static("access-control-allow-origin"), "*");
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{file_size}"),
        );
    }
    response
        .body(Body::from_stream(body_stream))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}


fn encode_url(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>()
}

fn build_request(
    client: &Client,
    url: &str,
    referer: &Option<String>,
    ua: &Option<String>,
) -> reqwest::RequestBuilder {
    let mut req = client.get(url);
    if let Some(ref r) = referer {
        req = req.header("Referer", r);
    }
    if let Some(ref u) = ua {
        req = req.header("User-Agent", u);
    } else {
        req = req.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    }
    req
}

fn resolve_url(base: &str, relative: &str) -> String {
    if relative.starts_with("http") {
        return relative.to_string();
    }
    if let Ok(base_url) = url::Url::parse(base) {
        if let Ok(joined) = base_url.join(relative) {
            return joined.to_string();
        }
    }
    relative.to_string()
}

fn build_proxy_url(
    port: u16,
    target_url: &str,
    is_playlist: bool,
    referer: &Option<String>,
    ua: &Option<String>,
) -> String {
    let encoded = encode_url(target_url);
    let route = if is_playlist {
        "playlist.m3u8"
    } else {
        "segment.ts"
    };
    let mut result = format!("http://127.0.0.1:{}/{}?url={}", port, route, encoded);
    if let Some(ref r) = referer {
        result.push_str(&format!("&referer={}", encode_url(r)));
    }
    if let Some(ref u) = ua {
        result.push_str(&format!("&ua={}", encode_url(u)));
    }
    result
}

async fn fetch_with_retry(
    client: &Client,
    url: &str,
    referer: &Option<String>,
    ua: &Option<String>,
    label: &str,
) -> Result<reqwest::Response, StatusCode> {
    let max_attempts = 3;
    for attempt in 1..=max_attempts {
        let req = build_request(client, url, referer, ua);
        match req.send().await {
            Ok(res) => {
                let status = res.status();
                if status.is_success() {
                    return Ok(res);
                }
                eprintln!(
                    "[stream_proxy] {} upstream returned {} for {} (attempt {}/{})",
                    label, status, url, attempt, max_attempts
                );
                if (status.as_u16() == 403 || status.as_u16() == 429 || status.is_server_error())
                    && attempt < max_attempts
                {
                    tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64))
                        .await;
                    continue;
                }
                return Err(StatusCode::BAD_GATEWAY);
            }
            Err(e) => {
                eprintln!(
                    "[stream_proxy] {} network error for {} (attempt {}/{}): {}",
                    label, url, attempt, max_attempts, e
                );
                if attempt < max_attempts {
                    tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64))
                        .await;
                    continue;
                }
                return Err(StatusCode::BAD_GATEWAY);
            }
        }
    }
    Err(StatusCode::BAD_GATEWAY)
}

async fn handle_proxy(
    State(state): State<ProxyState>,
    Query(query): Query<ProxyQuery>,
) -> Result<Response, StatusCode> {
    println!(
        "[stream_proxy] Received playlist request for: {}",
        query.url
    );
    let response = fetch_with_retry(
        &state.client,
        &query.url,
        &query.referer,
        &query.ua,
        "playlist",
    )
    .await?;

    let content_type = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !content_type.contains("mpegurl")
        && !content_type.contains("m3u8")
        && !content_type.contains("application/x-mpegURL")
    {
        // The CDN returned a direct video stream (e.g. MP4) instead of a playlist!
        let stream = response.bytes_stream();
        let body = axum::body::Body::from_stream(stream);
        return Ok(axum::response::Response::builder()
            .header(axum::http::header::CONTENT_TYPE, content_type)
            .body(body)
            .unwrap());
    }

    let text = response.text().await.map_err(|e| {
        eprintln!("[stream_proxy] Failed to read playlist body: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let is_master = text.contains("#EXT-X-STREAM-INF");

    let mut new_playlist = String::new();

    for line in text.lines() {
        if line.trim().is_empty() {
            new_playlist.push('\n');
            continue;
        }

        if line.starts_with("#EXT") && line.contains("URI=\"") {
            let mut processed = line.to_string();
            if let Some(start) = processed.find("URI=\"") {
                let uri_start = start + 5;
                if let Some(end_offset) = processed[uri_start..].find('"') {
                    let uri_end = uri_start + end_offset;
                    let original = processed[uri_start..uri_end].to_string();
                    let resolved = resolve_url(&query.url, &original);
                    let is_sub_playlist =
                        resolved.contains(".m3u8") || line.contains("EXT-X-MEDIA");
                    let new_uri = build_proxy_url(
                        state.port,
                        &resolved,
                        is_sub_playlist,
                        &query.referer,
                        &query.ua,
                    );
                    processed.replace_range(uri_start..uri_end, &new_uri);
                }
            }
            new_playlist.push_str(&processed);
            new_playlist.push('\n');
        } else if line.starts_with('#') {
            new_playlist.push_str(line);
            new_playlist.push('\n');
        } else {
            let resolved = resolve_url(&query.url, line.trim());
            let new_uri =
                build_proxy_url(state.port, &resolved, is_master, &query.referer, &query.ua);
            new_playlist.push_str(&new_uri);
            new_playlist.push('\n');
        }
    }

    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            "application/vnd.apple.mpegurl",
        )],
        new_playlist,
    )
        .into_response())
}

async fn handle_segment(
    State(state): State<ProxyState>,
    Query(query): Query<SegmentQuery>,
) -> Result<Response, StatusCode> {
    let response = fetch_with_retry(
        &state.client,
        &query.url,
        &query.referer,
        &query.ua,
        "segment",
    )
    .await?;

    let content_type = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/MP2T")
        .to_string();

    let url_lower = query.url.to_lowercase();
    let is_fmp4 = url_lower.contains(".mp4")
        || url_lower.contains(".m4s")
        || url_lower.contains(".m4v")
        || url_lower.contains(".m4a");

    if is_fmp4 {
        let stream = response.bytes_stream();
        let body = axum::body::Body::from_stream(stream);
        return Ok(Response::builder()
            .header(axum::http::header::CONTENT_TYPE, content_type)
            .body(body)
            .unwrap());
    }

    let bytes = response.bytes().await.map_err(|e| {
        eprintln!("[stream_proxy] Failed to read segment body: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let mut data = bytes.to_vec();

    for i in 0..data.len() {
        if data[i] == 0x47 && i + 188 < data.len() && data[i + 188] == 0x47 {
            if i > 0 {
                data = data[i..].to_vec();
            }
            break;
        }
    }

    Ok(([(axum::http::header::CONTENT_TYPE, content_type)], data).into_response())
}

fn resolve_source_url(state: &ProxyState, raw_url: &str) -> String {
    if let Some(token) = raw_url.strip_prefix("local://") {
        if let Ok(files) = state.local_files.lock() {
            if let Some(path) = files.get(token) {
                return path.to_string_lossy().to_string();
            }
        }
    }
    raw_url.to_string()
}

async fn handle_cancel_remux(
    State(state): State<ProxyState>,
    Query(query): Query<CancelQuery>,
) -> impl IntoResponse {
    let mut sessions = state.sessions.lock().await;
    if let Some(tx) = sessions.remove(&query.session_id) {
        let _ = tx.send(());
    }
    StatusCode::OK
}

async fn handle_probe(
    State(state): State<ProxyState>,
    Query(query): Query<ProbeQuery>,
) -> impl IntoResponse {
    let source = resolve_source_url(&state, &query.url);
    let mut headers = HashMap::new();
    if let Some(ref r) = query.referer {
        headers.insert("Referer".to_string(), r.clone());
    }
    if let Some(ref ua) = query.ua {
        headers.insert("User-Agent".to_string(), ua.clone());
    }
    if let Some(ref orig) = query.origin {
        headers.insert("Origin".to_string(), orig.clone());
    }
    let headers_opt = if headers.is_empty() { None } else { Some(headers) };

    match media_probe::probe_media(&source, headers_opt).await {
        Ok(info) => {
            let json = serde_json::to_string(&info).unwrap_or_default();
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/json"),
                    (header::HeaderName::from_static("access-control-allow-origin"), "*"),
                ],
                json,
            )
                .into_response()
        }
        Err(err) => {
            eprintln!("[probe] Error: {}", err);
            (
                StatusCode::BAD_REQUEST,
                [
                    (header::CONTENT_TYPE, "text/plain"),
                    (header::HeaderName::from_static("access-control-allow-origin"), "*"),
                ],
                err,
            )
                .into_response()
        }
    }
}

async fn handle_subs(
    State(state): State<ProxyState>,
    Query(query): Query<SubsQuery>,
) -> impl IntoResponse {
    let source = resolve_source_url(&state, &query.url);
    let mut headers = HashMap::new();
    if let Some(ref r) = query.referer {
        headers.insert("Referer".to_string(), r.clone());
    }
    if let Some(ref ua) = query.ua {
        headers.insert("User-Agent".to_string(), ua.clone());
    }
    if let Some(ref orig) = query.origin {
        headers.insert("Origin".to_string(), orig.clone());
    }
    let headers_opt = if headers.is_empty() { None } else { Some(headers) };

    match media_probe::extract_subtitles_to_string(None, &source, query.sub_index, headers_opt).await {
        Ok(text) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
                (header::HeaderName::from_static("access-control-allow-origin"), "*"),
            ],
            text,
        )
            .into_response(),
        Err(err) => {
            eprintln!("[subs] Error: {}", err);
            (
                StatusCode::BAD_REQUEST,
                [
                    (header::CONTENT_TYPE, "text/plain"),
                    (header::HeaderName::from_static("access-control-allow-origin"), "*"),
                ],
                err,
            )
                .into_response()
        }
    }
}

async fn handle_remux(
    State(state): State<ProxyState>,
    Query(query): Query<RemuxQuery>,
) -> Result<Response, StatusCode> {
    let source = resolve_source_url(&state, &query.url);
    let ffmpeg_path = match ffmpeg_resolver::get_ffmpeg_path() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[remux] FFmpeg not found ({}), streaming directly via proxy", e);
            let mut req = state.client.get(&source);
            if let Some(ref r) = query.referer {
                req = req.header("Referer", r);
            }
            if let Some(ref ua) = query.ua {
                req = req.header("User-Agent", ua);
            }
            if let Some(ref orig) = query.origin {
                req = req.header("Origin", orig);
            }
            let resp = req.send().await.map_err(|err| {
                eprintln!("[remux] Direct stream error: {}", err);
                StatusCode::BAD_GATEWAY
            })?;
            let status = resp.status();
            let mut builder = Response::builder().status(status);
            if let Some(ct) = resp.headers().get(axum::http::header::CONTENT_TYPE) {
                builder = builder.header(axum::http::header::CONTENT_TYPE, ct);
            }
            if let Some(cr) = resp.headers().get(axum::http::header::CONTENT_RANGE) {
                builder = builder.header(axum::http::header::CONTENT_RANGE, cr);
            }
            if let Some(ar) = resp.headers().get(axum::http::header::ACCEPT_RANGES) {
                builder = builder.header(axum::http::header::ACCEPT_RANGES, ar);
            }
            let body = axum::body::Body::from_stream(resp.bytes_stream());
            return builder.body(body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    if let Some(ref sid) = query.session_id {
        state.remux_infos.lock().await.remove(sid);
    }

    let mut cmd = tokio::process::Command::new(&ffmpeg_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    if let Some(parent) = ffmpeg_path.parent() {
        cmd.current_dir(parent);
        if let Ok(path_var) = std::env::var("PATH") {
            cmd.env("PATH", format!("{};{}", parent.display(), path_var));
        } else {
            cmd.env("PATH", parent);
        }
    }

    cmd.arg("-v").arg("error").arg("-stats");

    if let Some(start) = query.start {
        if start > 0.05 {
            cmd.arg("-ss").arg(format!("{:.3}", start));
        }
    }

    let is_network = source.starts_with("http://") || source.starts_with("https://");
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

    let mut headers_str = Vec::new();
    if let Some(ref r) = query.referer {
        headers_str.push(format!("Referer: {}", r.replace('\r', "").replace('\n', "")));
    }
    if let Some(ref ua) = query.ua {
        headers_str.push(format!("User-Agent: {}", ua.replace('\r', "").replace('\n', "")));
    }
    if let Some(ref orig) = query.origin {
        headers_str.push(format!("Origin: {}", orig.replace('\r', "").replace('\n', "")));
    }
    if !headers_str.is_empty() {
        headers_str.push(String::new());
        cmd.arg("-headers").arg(headers_str.join("\r\n"));
    }

    cmd.arg("-i").arg(&source);

    let v_idx_opt = query.video_index;
    let a_idx_opt = query.audio_index;

    if let Some(v_idx) = v_idx_opt {
        cmd.arg("-map").arg(format!("0:{}", v_idx));
    } else {
        cmd.arg("-map").arg("0:v:0");
    }

    if let Some(a_idx) = a_idx_opt {
        if a_idx == 0 && v_idx_opt.unwrap_or(0) == 0 {
            cmd.arg("-map").arg("0:a:0");
        } else {
            cmd.arg("-map").arg(format!("0:{}", a_idx));
        }
    } else {
        cmd.arg("-map").arg("0:a:0?");
    }

    let is_transcode = query.mode.as_deref() == Some("transcode");
    if is_transcode {
        cmd.arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("veryfast")
            .arg("-crf")
            .arg("22")
            .arg("-pix_fmt")
            .arg("yuv420p");
    } else {
        cmd.arg("-c:v").arg("copy");
    }

    let audio_delay_val = query.audio_delay.unwrap_or(0.0);
    let is_aac = query
        .audio_codec
        .as_deref()
        .map(|c| c.to_lowercase().contains("aac"))
        .unwrap_or(false);

    if is_aac && audio_delay_val.abs() <= 4.0 {
        cmd.arg("-c:a").arg("copy");
    } else {
        cmd.arg("-c:a")
            .arg("aac")
            .arg("-b:a")
            .arg("192k")
            .arg("-ac")
            .arg("2");

        let mut audio_filters: Vec<String> = Vec::new();
        if audio_delay_val > 4.0 {
            audio_filters.push(format!("adelay={}|{}:all=1", audio_delay_val as i64, audio_delay_val as i64));
        } else if audio_delay_val < -4.0 {
            let trim_sec = (-audio_delay_val) / 1000.0;
            audio_filters.push(format!("atrim=start={:.3},asetpts=PTS-STARTPTS", trim_sec));
        }
        audio_filters.push("aresample=async=1".to_string());
        cmd.arg("-af").arg(audio_filters.join(","));
    }

    cmd.arg("-avoid_negative_ts").arg("make_zero");
    cmd.arg("-fflags").arg("+genpts");
    cmd.arg("-flush_packets").arg("1");

    cmd.arg("-f")
        .arg("mp4")
        .arg("-movflags")
        .arg("frag_keyframe+empty_moov+default_base_moof")
        .arg("pipe:1");

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        eprintln!("[remux] Failed to spawn FFmpeg: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let stdout = child.stdout.take().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let stderr = child.stderr.take();

    let session_id_opt = query.session_id.clone();
    let requested_start = query.start.unwrap_or(0.0);
    let remux_infos = state.remux_infos.clone();
    let app_opt = state.app.clone();

    if let Some(mut err_pipe) = stderr {
        let sid_for_task = session_id_opt.clone();
        tokio::spawn(async move {
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 1024];
            let mut captured = false;
            while let Ok(n) = err_pipe.read(&mut chunk).await {
                if n == 0 {
                    break;
                }
                if !captured {
                    buffer.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buffer);
                    if let Some(pos) = text.find("time=") {
                        let after = &text[pos + 5..];
                        if let Some(token) = after.split_whitespace().next() {
                            let token = token.trim_matches(|c| c == '\r' || c == '\n');
                            let negative = token.starts_with('-');
                            let clean = token.trim_start_matches('-').trim_start_matches('+');
                            let parts: Vec<&str> = clean.split(':').collect();
                            if parts.len() == 3 {
                                if let (Ok(h), Ok(m), Ok(s)) = (
                                    parts[0].parse::<f64>(),
                                    parts[1].parse::<f64>(),
                                    parts[2].parse::<f64>(),
                                ) {
                                    captured = true;
                                    let total_sec = h * 3600.0 + m * 60.0 + s;
                                    let offset_sec = if negative { -total_sec } else { total_sec };
                                    let actual_start = (requested_start + offset_sec).max(0.0);
                                    let initial_skip = (requested_start - actual_start).max(0.0);
                                    let info = RemuxStreamInfo {
                                        session_id: sid_for_task.clone().unwrap_or_default(),
                                        requested_start,
                                        actual_start,
                                        initial_skip,
                                    };
                                    if let Some(ref sid) = sid_for_task {
                                        remux_infos.lock().await.insert(sid.clone(), info.clone());
                                    }
                                    if let Some(ref app) = app_opt {
                                        let _ = app.emit("remux_stream_info", &info);
                                    }
                                    eprintln!(
                                        "[remux] Stream timing aligned: requested={:.3}s, actual={:.3}s (offset={:.3}s)",
                                        requested_start, actual_start, offset_sec
                                    );
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let session_id_opt = query.session_id.clone();
    if let Some(ref sid) = session_id_opt {
        let mut sessions = state.sessions.lock().await;
        if let Some(old_tx) = sessions.remove(sid) {
            let _ = old_tx.send(());
        }
        sessions.insert(sid.clone(), cancel_tx);
    }

    let body_stream = stream::try_unfold(
        (stdout, child, cancel_rx),
        move |(mut stdout, child, mut cancel_rx)| async move {
            let mut buffer = vec![0u8; 64 * 1024];
            tokio::select! {
                _ = &mut cancel_rx => {
                    Ok::<_, std::io::Error>(None)
                }
                res = stdout.read(&mut buffer) => {
                    match res {
                        Ok(0) => Ok(None),
                        Ok(n) => {
                            buffer.truncate(n);
                            Ok(Some((Bytes::from(buffer), (stdout, child, cancel_rx))))
                        }
                        Err(e) => Err(e),
                    }
                }
            }
        },
    );

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::CACHE_CONTROL, "no-cache, no-store")
        .header(header::ACCEPT_RANGES, "none")
        .header(header::HeaderName::from_static("access-control-allow-origin"), "*")
        .body(Body::from_stream(body_stream))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(response)
}

#[cfg(test)]
mod local_file_tests {
    use super::{parse_byte_range, start_server, LocalFileRegistry};
    use reqwest::header::RANGE;
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };

    #[test]
    fn parses_local_file_ranges() {
        assert_eq!(parse_byte_range("bytes=10-19", 100).unwrap(), (10, 19));
        assert_eq!(parse_byte_range("bytes=90-", 100).unwrap(), (90, 99));
        assert_eq!(parse_byte_range("bytes=-10", 100).unwrap(), (90, 99));
        assert!(parse_byte_range("bytes=100-", 100).is_err());
    }

    #[tokio::test]
    async fn streams_registered_local_file_ranges() {
        let path = std::env::temp_dir().join(format!(
            "vega-local-stream-{}-{}.mkv",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, b"0123456789abcdef").unwrap();
        let registry: LocalFileRegistry = Arc::new(Mutex::new(HashMap::new()));
        registry
            .lock()
            .unwrap()
            .insert("test".to_string(), path.clone());
        let port = start_server(registry, None).await.unwrap();

        let response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/local/test/video.mkv"))
            .header(RANGE, "bytes=4-7")
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.bytes().await.unwrap(), b"4567".as_slice());
        std::fs::remove_file(path).unwrap();
    }
}

use axum::{
    body::{Body, Bytes},
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::stream;
use hickory_resolver::TokioAsyncResolver;
use reqwest::{
    dns::{Addrs, Name, Resolve, Resolving},
    Client,
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    io::SeekFrom,
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, BufReader};
use tokio::net::TcpListener;

use crate::ffmpeg_resolver;
use crate::media_probe;

#[derive(Clone)]
pub struct StreamDnsResolver {
    resolver: Arc<tokio::sync::RwLock<TokioAsyncResolver>>,
    enabled: Arc<tokio::sync::RwLock<bool>>,
    config_key: Arc<tokio::sync::RwLock<String>>,
}

impl StreamDnsResolver {
    pub fn new() -> Self {
        let resolver = crate::doh_client::build_hickory_resolver("cloudflare", None);
        Self {
            resolver: Arc::new(tokio::sync::RwLock::new(resolver)),
            enabled: Arc::new(tokio::sync::RwLock::new(true)),
            config_key: Arc::new(tokio::sync::RwLock::new("true_cloudflare_".to_string())),
        }
    }

    pub async fn update_config(&self, provider: &str, custom_url: Option<String>, enabled: bool) {
        let key = format!("{}_{}_{}", enabled, provider, custom_url.as_deref().unwrap_or_default());
        {
            let current = self.config_key.read().await;
            if *current == key {
                return;
            }
        }

        let is_system = provider.eq_ignore_ascii_case("system") || provider.eq_ignore_ascii_case("none");
        let effective_enabled = enabled && !is_system;

        if effective_enabled {
            let new_res = crate::doh_client::build_hickory_resolver(provider, custom_url.clone());
            let mut res_guard = self.resolver.write().await;
            *res_guard = new_res;
        }

        let mut enabled_guard = self.enabled.write().await;
        *enabled_guard = effective_enabled;

        let mut key_guard = self.config_key.write().await;
        *key_guard = key;

        println!(
            "[stream_proxy] DNS resolver updated: enabled={}, provider={}, custom={:?}",
            effective_enabled, provider, custom_url
        );
    }
}

impl Resolve for StreamDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let resolver_lock = self.resolver.clone();
        let enabled_lock = self.enabled.clone();
        let name_str = name.as_str().to_string();

        Box::pin(async move {
            if let Ok(ip) = name_str.parse::<std::net::IpAddr>() {
                return Ok(Box::new(std::iter::once(SocketAddr::new(ip, 0))) as Addrs);
            }

            if name_str.eq_ignore_ascii_case("localhost") {
                let local_addrs = vec![
                    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0),
                ];
                return Ok(Box::new(local_addrs.into_iter()) as Addrs);
            }

            let is_enabled = *enabled_lock.read().await;
            if is_enabled {
                let resolver = resolver_lock.read().await;
                match resolver.lookup_ip(name_str.as_str()).await {
                    Ok(response) => {
                        let addrs: Vec<SocketAddr> = response
                            .into_iter()
                            .map(|ip| SocketAddr::new(ip, 0))
                            .collect();
                        return Ok(Box::new(addrs.into_iter()) as Addrs);
                    }
                    Err(e) => {
                        eprintln!(
                            "[stream_proxy] DoH resolution failed for {}: {:?}. Falling back to system DNS...",
                            name_str, e
                        );
                    }
                }
            }

            match tokio::net::lookup_host(format!("{}:0", name_str)).await {
                Ok(std_addrs) => {
                    let addrs: Vec<SocketAddr> = std_addrs.collect();
                    Ok(Box::new(addrs.into_iter()) as Addrs)
                }
                Err(sys_err) => {
                    eprintln!(
                        "[stream_proxy] System DNS also failed for {}: {:?}",
                        name_str, sys_err
                    );
                    Err(Box::new(sys_err) as Box<dyn std::error::Error + Send + Sync>)
                }
            }
        })
    }
}

lazy_static::lazy_static! {
    pub static ref GLOBAL_STREAM_RESOLVER: Arc<StreamDnsResolver> = Arc::new(StreamDnsResolver::new());
}

#[tauri::command]
pub async fn set_stream_doh(
    provider: String,
    custom_url: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    GLOBAL_STREAM_RESOLVER
        .update_config(&provider, custom_url, enabled)
        .await;
    Ok(())
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RemuxStreamInfo {
    pub session_id: String,
    pub generation: u64,
    pub requested_start: f64,
    pub source_reference_pts: Option<f64>,
    pub output_reference_pts: Option<f64>,
}

pub type LocalFileRegistry = Arc<Mutex<HashMap<String, PathBuf>>>;
pub type SessionRegistry =
    Arc<tokio::sync::Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>>;
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
    #[serde(default)]
    origin: Option<String>,
    #[serde(default)]
    headers: Option<String>,
    #[serde(default)]
    sub: Option<bool>,
}

#[derive(Deserialize)]
pub struct SegmentQuery {
    url: String,
    #[serde(default)]
    referer: Option<String>,
    #[serde(default)]
    ua: Option<String>,
    #[serde(default)]
    origin: Option<String>,
    #[serde(default)]
    headers: Option<String>,
}

#[derive(Deserialize)]
pub struct RemuxQuery {
    url: String,
    #[serde(default)]
    start: Option<f64>,
    #[serde(default)]
    generation: Option<u64>,
    #[serde(default)]
    audio_index: Option<u32>,
    #[serde(default)]
    video_index: Option<u32>,
    #[serde(default)]
    audio_delay: Option<f64>,
    #[serde(default)]
    audio_codec: Option<String>,
    #[serde(default)]
    video_codec: Option<String>,
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
    #[serde(default)]
    headers: Option<String>,
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
    #[serde(default)]
    headers: Option<String>,
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
    #[serde(default)]
    headers: Option<String>,
}

#[derive(Deserialize)]
pub struct CancelQuery {
    session_id: String,
}

#[derive(Deserialize)]
pub struct RemuxInfoQuery {
    pub session_id: String,
    #[serde(default)]
    pub generation: Option<u64>,
}

async fn handle_remux_info(
    State(state): State<ProxyState>,
    Query(query): Query<RemuxInfoQuery>,
) -> Response {
    let infos = state.remux_infos.lock().await;
    if let Some(info) = infos.get(&query.session_id) {
        if query
            .generation
            .map_or(true, |generation| generation == info.generation)
        {
            return axum::Json(info.clone()).into_response();
        }
    }
    StatusCode::NO_CONTENT.into_response()
}

pub async fn start_server(
    local_files: LocalFileRegistry,
    app_handle: Option<tauri::AppHandle>,
) -> Result<u16, String> {
    let client = Client::builder()
        .dns_resolver(GLOBAL_STREAM_RESOLVER.clone())
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
        .layer(tower_http::cors::CorsLayer::permissive())
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

async fn serve_local_file(
    path: &Path,
    range_header: Option<&HeaderValue>,
) -> Result<Response, StatusCode> {
    if !path.is_file() {
        eprintln!("[stream_server] serve_local_file: not found: {:?}", path);
        return Err(StatusCode::NOT_FOUND);
    }
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let file_size = file
        .metadata()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .len();

    let requested_range = range_header
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
        .header(header::CONTENT_TYPE, content_type);
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
    serve_local_file(&path, headers.get(header::RANGE)).await
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
    serve_local_file(&path, headers.get(header::RANGE)).await
}

fn encode_url(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>()
}

fn collect_request_headers(
    referer: &Option<String>,
    ua: &Option<String>,
    origin: &Option<String>,
    headers_json: &Option<String>,
) -> HashMap<String, String> {
    let mut map: HashMap<String, String> = HashMap::new();

    if let Some(ref json_str) = headers_json {
        if let Ok(parsed) = serde_json::from_str::<HashMap<String, String>>(json_str) {
            for (k, v) in parsed {
                map.insert(k, v);
            }
        }
    }

    if let Some(ref r) = referer {
        map.insert("Referer".to_string(), r.clone());
    }
    if let Some(ref u) = ua {
        map.insert("User-Agent".to_string(), u.clone());
    }
    if let Some(ref o) = origin {
        map.insert("Origin".to_string(), o.clone());
    }

    let has_ua = map.keys().any(|k| k.eq_ignore_ascii_case("user-agent"));
    if !has_ua {
        map.insert(
            "User-Agent".to_string(),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
        );
    }

    let has_origin = map.keys().any(|k| k.eq_ignore_ascii_case("origin"));
    if !has_origin {
        let referer_val = map
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("referer"))
            .map(|(_, v)| v.clone());
        if let Some(ref r) = referer_val {
            if let Ok(u) = url::Url::parse(r) {
                let ascii_origin = u.origin().ascii_serialization();
                if ascii_origin != "null" {
                    map.insert("Origin".to_string(), ascii_origin);
                }
            }
        }
    }

    map
}

fn build_request(
    client: &Client,
    url: &str,
    headers_map: &HashMap<String, String>,
) -> reqwest::RequestBuilder {
    let mut req = client.get(url);
    for (k, v) in headers_map {
        if !k.eq_ignore_ascii_case("host") && !k.eq_ignore_ascii_case("content-length") {
            req = req.header(k.as_str(), v.as_str());
        }
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
    headers_map: &HashMap<String, String>,
) -> String {
    let encoded = encode_url(target_url);
    let route = if is_playlist {
        "playlist.m3u8"
    } else {
        "segment.ts"
    };
    let mut result = format!("http://127.0.0.1:{}/{}?url={}", port, route, encoded);
    if is_playlist {
        result.push_str("&sub=true");
    }
    if let Ok(json_str) = serde_json::to_string(headers_map) {
        result.push_str(&format!("&headers={}", encode_url(&json_str)));
    }
    for (k, v) in headers_map {
        if k.eq_ignore_ascii_case("referer") {
            result.push_str(&format!("&referer={}", encode_url(v)));
        } else if k.eq_ignore_ascii_case("user-agent") {
            result.push_str(&format!("&ua={}", encode_url(v)));
        } else if k.eq_ignore_ascii_case("origin") {
            result.push_str(&format!("&origin={}", encode_url(v)));
        }
    }
    result
}

async fn fetch_with_retry(
    client: &Client,
    url: &str,
    headers_map: &HashMap<String, String>,
    label: &str,
) -> Result<reqwest::Response, StatusCode> {
    let max_attempts = 3;
    for attempt in 1..=max_attempts {
        let req = build_request(client, url, headers_map);
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
    let headers_map = collect_request_headers(
        &query.referer,
        &query.ua,
        &query.origin,
        &query.headers,
    );

    let response = fetch_with_retry(
        &state.client,
        &query.url,
        &headers_map,
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

    // If this is a media playlist (not a master playlist), and not already requested as a child sub-playlist (sub != Some(true)),
    // check if it has a parent master playlist containing separate audio track(s) (RFC 8216 demuxed streams).
    // If so, synthesize a master playlist linking this video playlist with the parent's audio tracks!
    if !is_master && query.sub != Some(true) {
        let parent_master_url = resolve_url(&query.url, "../master.m3u8");
        if parent_master_url != query.url && !query.url.ends_with("master.m3u8") {
            if let Ok(master_res) = fetch_with_retry(
                &state.client,
                &parent_master_url,
                &headers_map,
                "parent_master",
            )
            .await
            {
                if master_res.status().is_success() {
                    if let Ok(master_text) = master_res.text().await {
                        if master_text.contains("#EXT-X-MEDIA:TYPE=AUDIO") {
                            let mut synth = String::from("#EXTM3U\n#EXT-X-INDEPENDENT-SEGMENTS\n");
                            let mut found_audio = false;

                            // 1. Copy and proxy all #EXT-X-MEDIA:TYPE=AUDIO and SUBTITLE lines from master
                            for line in master_text.lines() {
                                if line.starts_with("#EXT-X-MEDIA:TYPE=AUDIO")
                                    || line.starts_with("#EXT-X-MEDIA:TYPE=SUBTITLES")
                                {
                                    let mut processed = line.to_string();
                                    if let Some(start) = processed.find("URI=\"") {
                                        let uri_start = start + 5;
                                        if let Some(end_offset) = processed[uri_start..].find('"') {
                                            let uri_end = uri_start + end_offset;
                                            let orig_uri = processed[uri_start..uri_end].to_string();
                                            let resolved = resolve_url(&parent_master_url, &orig_uri);
                                            let new_uri = build_proxy_url(state.port, &resolved, true, &headers_map);
                                            processed.replace_range(uri_start..uri_end, &new_uri);
                                            found_audio = true;
                                        }
                                    }
                                    synth.push_str(&processed);
                                    synth.push('\n');
                                }
                            }

                            if found_audio {
                                // 2. Find matching #EXT-X-STREAM-INF from parent master, or synthesize one
                                let mut stream_inf_line = None;
                                let master_lines: Vec<&str> = master_text.lines().collect();
                                for (i, mline) in master_lines.iter().enumerate() {
                                    if mline.starts_with("#EXT-X-STREAM-INF") {
                                        if let Some(next) = master_lines.get(i + 1) {
                                            let next_trimmed = next.trim();
                                            let res_url = resolve_url(&parent_master_url, next_trimmed);
                                            if res_url == query.url || query.url.ends_with(next_trimmed) {
                                                stream_inf_line = Some(mline.to_string());
                                                break;
                                            }
                                        }
                                    }
                                }

                                let effective_inf = stream_inf_line.unwrap_or_else(|| {
                                    "#EXT-X-STREAM-INF:BANDWIDTH=5000000,AUDIO=\"stereo\"".to_string()
                                });
                                synth.push_str(&effective_inf);
                                synth.push('\n');

                                // 3. The video variant playlist URL (marked with sub=true)
                                let video_variant_url = build_proxy_url(state.port, &query.url, true, &headers_map);
                                synth.push_str(&video_variant_url);
                                synth.push('\n');

                                println!(
                                    "[stream_proxy] Synthesized master playlist for single quality track: {}",
                                    query.url
                                );

                                return Ok(Response::builder()
                                    .header(
                                        axum::http::header::CONTENT_TYPE,
                                        "application/vnd.apple.mpegurl",
                                    )
                                    .body(Body::from(synth))
                                    .unwrap());
                            }
                        }
                    }
                }
            }
        }
    }

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
                        &headers_map,
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
                build_proxy_url(state.port, &resolved, is_master, &headers_map);
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
    let headers_map = collect_request_headers(
        &query.referer,
        &query.ua,
        &query.origin,
        &query.headers,
    );

    let response = fetch_with_retry(
        &state.client,
        &query.url,
        &headers_map,
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

    for i in 0..data.len().saturating_sub(188) {
        if data[i] == 0x47 && data[i + 188] == 0x47 {
            if i + 376 < data.len() && data[i + 376] != 0x47 {
                continue;
            }
            if i > 0 {
                data = data[i..].to_vec();
            }
            break;
        }
    }

    let response_content_type = if data.starts_with(b"\x47") {
        "video/MP2T".to_string()
    } else {
        content_type
    };

    Ok(([(axum::http::header::CONTENT_TYPE, response_content_type)], data).into_response())
}

fn resolve_source_url(state: &ProxyState, raw_url: &str) -> String {
    let cleaned = crate::ffmpeg_resolver::clean_source(raw_url);
    if let Some(token) = cleaned.strip_prefix("local://") {
        if let Ok(files) = state.local_files.lock() {
            if let Some(path) = files.get(token) {
                return path.to_string_lossy().to_string();
            }
        }
    }
    cleaned
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
    let headers_map = collect_request_headers(
        &query.referer,
        &query.ua,
        &query.origin,
        &query.headers,
    );
    let headers_opt = if headers_map.is_empty() {
        None
    } else {
        Some(headers_map)
    };

    match media_probe::probe_media(&source, headers_opt).await {
        Ok(info) => {
            let json = serde_json::to_string(&info).unwrap_or_default();
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/json")],
                json,
            )
                .into_response()
        }
        Err(err) => {
            eprintln!("[probe] Error: {}", err);
            (
                StatusCode::BAD_REQUEST,
                [(header::CONTENT_TYPE, "text/plain")],
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
    let headers_map = collect_request_headers(
        &query.referer,
        &query.ua,
        &query.origin,
        &query.headers,
    );
    let headers_opt = if headers_map.is_empty() {
        None
    } else {
        Some(headers_map)
    };

    match media_probe::extract_subtitles_to_string(None, &source, query.sub_index, headers_opt)
        .await
    {
        Ok(text) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            text,
        )
            .into_response(),
        Err(err) => {
            eprintln!("[subs] Error: {}", err);
            (
                StatusCode::BAD_REQUEST,
                [(header::CONTENT_TYPE, "text/plain")],
                err,
            )
                .into_response()
        }
    }
}

#[derive(Clone, Copy)]
struct Mp4BoxRef {
    kind: [u8; 4],
    payload_start: usize,
    end: usize,
}

fn read_u32_be(buf: &[u8], pos: usize) -> Option<u32> {
    Some(u32::from_be_bytes(buf.get(pos..pos + 4)?.try_into().ok()?))
}

fn read_u64_be(buf: &[u8], pos: usize) -> Option<u64> {
    Some(u64::from_be_bytes(buf.get(pos..pos + 8)?.try_into().ok()?))
}

fn mp4_children(buf: &[u8], start: usize, end: usize) -> Option<Vec<Mp4BoxRef>> {
    if start > end || end > buf.len() {
        return None;
    }
    let mut boxes = Vec::new();
    let mut pos = start;
    while pos < end {
        if end - pos < 8 {
            return None;
        }
        let size32 = read_u32_be(buf, pos)? as usize;
        let kind: [u8; 4] = buf.get(pos + 4..pos + 8)?.try_into().ok()?;
        let (size, header_size) = if size32 == 1 {
            let size64 = read_u64_be(buf, pos + 8)?;
            if size64 > usize::MAX as u64 {
                return None;
            }
            (size64 as usize, 16)
        } else if size32 == 0 {
            (end - pos, 8)
        } else {
            (size32, 8)
        };
        if size < header_size || size > 16 * 1024 * 1024 || pos.checked_add(size)? > end {
            return None;
        }
        boxes.push(Mp4BoxRef {
            kind,
            payload_start: pos + header_size,
            end: pos + size,
        });
        pos += size;
    }
    Some(boxes)
}

fn mp4_top_level(buf: &[u8]) -> Option<Vec<Mp4BoxRef>> {
    let mut boxes = Vec::new();
    let mut pos = 0usize;
    while buf.len().saturating_sub(pos) >= 8 {
        let size32 = read_u32_be(buf, pos)? as usize;
        let kind: [u8; 4] = buf.get(pos + 4..pos + 8)?.try_into().ok()?;
        let (size, header_size) = if size32 == 1 {
            if buf.len().saturating_sub(pos) < 16 {
                break;
            }
            let size64 = read_u64_be(buf, pos + 8)?;
            if size64 > usize::MAX as u64 {
                return None;
            }
            (size64 as usize, 16)
        } else if size32 == 0 {
            break;
        } else {
            (size32, 8)
        };
        if kind == *b"mdat" {
            // We only need the complete initialization and movie-fragment boxes.
            // The media payload can be much larger than the startup buffer.
            break;
        }
        if size < header_size || size > 16 * 1024 * 1024 {
            return None;
        }
        let Some(end) = pos.checked_add(size) else {
            return None;
        };
        if end > buf.len() {
            break;
        }
        boxes.push(Mp4BoxRef {
            kind,
            payload_start: pos + header_size,
            end,
        });
        pos = end;
    }
    Some(boxes)
}

fn child_box(buf: &[u8], parent: Mp4BoxRef, kind: &[u8; 4]) -> Option<Mp4BoxRef> {
    mp4_children(buf, parent.payload_start, parent.end)?
        .into_iter()
        .find(|entry| &entry.kind == kind)
}

fn video_track_timing(buf: &[u8], moov: Mp4BoxRef) -> Option<(u32, f64)> {
    for trak in mp4_children(buf, moov.payload_start, moov.end)?
        .into_iter()
        .filter(|entry| entry.kind == *b"trak")
    {
        let tkhd = child_box(buf, trak, b"tkhd")?;
        let tkhd_version = *buf.get(tkhd.payload_start)?;
        let track_id_pos = tkhd.payload_start + if tkhd_version == 1 { 20 } else { 12 };
        let track_id = read_u32_be(buf, track_id_pos)?;

        let mdia = child_box(buf, trak, b"mdia")?;
        let hdlr = child_box(buf, mdia, b"hdlr")?;
        if buf.get(hdlr.payload_start + 8..hdlr.payload_start + 12)? != b"vide" {
            continue;
        }
        let mdhd = child_box(buf, mdia, b"mdhd")?;
        let mdhd_version = *buf.get(mdhd.payload_start)?;
        let timescale_pos = mdhd.payload_start + if mdhd_version == 1 { 20 } else { 12 };
        let timescale = read_u32_be(buf, timescale_pos)?;
        if timescale > 0 {
            return Some((track_id, timescale as f64));
        }
    }
    None
}

fn first_sample_composition_offset(buf: &[u8], trun: Mp4BoxRef) -> Option<i64> {
    let version = *buf.get(trun.payload_start)?;
    let flags = ((*buf.get(trun.payload_start + 1)? as u32) << 16)
        | ((*buf.get(trun.payload_start + 2)? as u32) << 8)
        | *buf.get(trun.payload_start + 3)? as u32;
    let sample_count = read_u32_be(buf, trun.payload_start + 4)?;
    if sample_count == 0 {
        return None;
    }
    let mut pos = trun.payload_start + 8;
    if flags & 0x000001 != 0 {
        pos += 4;
    }
    if flags & 0x000004 != 0 {
        pos += 4;
    }
    if flags & 0x000100 != 0 {
        pos += 4;
    }
    if flags & 0x000200 != 0 {
        pos += 4;
    }
    if flags & 0x000400 != 0 {
        pos += 4;
    }
    if flags & 0x000800 == 0 {
        return Some(0);
    }
    let raw = read_u32_be(buf, pos)?;
    Some(if version == 0 {
        raw as i64
    } else {
        (raw as i32) as i64
    })
}

fn extract_mp4_output_reference_pts(buf: &[u8]) -> Option<f64> {
    let top_level = mp4_top_level(buf)?;
    let moov = *top_level.iter().find(|entry| entry.kind == *b"moov")?;
    let (video_track_id, timescale) = video_track_timing(buf, moov)?;

    for moof in top_level.into_iter().filter(|entry| entry.kind == *b"moof") {
        for traf in mp4_children(buf, moof.payload_start, moof.end)?
            .into_iter()
            .filter(|entry| entry.kind == *b"traf")
        {
            let tfhd = child_box(buf, traf, b"tfhd")?;
            if read_u32_be(buf, tfhd.payload_start + 4)? != video_track_id {
                continue;
            }
            let tfdt = child_box(buf, traf, b"tfdt")?;
            let decode_time = if *buf.get(tfdt.payload_start)? == 1 {
                read_u64_be(buf, tfdt.payload_start + 4)?
            } else {
                read_u32_be(buf, tfdt.payload_start + 4)? as u64
            };
            let trun = child_box(buf, traf, b"trun")?;
            let composition_offset = first_sample_composition_offset(buf, trun)?;
            return Some((decode_time as f64 + composition_offset as f64) / timescale);
        }
    }
    None
}

fn parse_ffmpeg_source_video_pts(line: &str, video_stream_index: u32) -> Option<f64> {
    if !line.contains("demuxer ->") || !line.contains("type:video") {
        return None;
    }
    let ist_part = line.split("ist_index:").nth(1)?.split_whitespace().next()?;
    let stream_idx: u32 = if let Some((_, sub)) = ist_part.split_once(':') {
        sub.parse().ok()?
    } else {
        ist_part.parse().ok()?
    };
    if stream_idx != video_stream_index {
        return None;
    }
    let marker = "pkt_pts_time:";
    let value = line.split(marker).nth(1)?.split_whitespace().next()?;
    value.parse::<f64>().ok().filter(|pts| pts.is_finite())
}

#[cfg(test)]
mod remux_timing_tests {
    use super::*;

    fn mp4_box(kind: &[u8; 4], payload: Vec<u8>) -> Vec<u8> {
        let mut result = Vec::with_capacity(payload.len() + 8);
        result.extend_from_slice(&((payload.len() + 8) as u32).to_be_bytes());
        result.extend_from_slice(kind);
        result.extend_from_slice(&payload);
        result
    }

    #[test]
    fn parses_selected_ffmpeg_video_packet_timestamp() {
        let line = "demuxer -> ist_index:2 type:video next_dts:0 pkt_pts:270000 pkt_pts_time:3.000 pkt_dts:270000";
        assert_eq!(parse_ffmpeg_source_video_pts(line, 2), Some(3.0));
        assert_eq!(parse_ffmpeg_source_video_pts(line, 0), None);

        // FFmpeg 6.x compound input format (ist_index:file_idx:stream_idx)
        let line_v6 = "[vist#0:0/h264] demuxer -> ist_index:0:0 type:video pkt_pts:2000 pkt_pts_time:2.000 pkt_dts:1958";
        assert_eq!(parse_ffmpeg_source_video_pts(line_v6, 0), Some(2.0));
        assert_eq!(parse_ffmpeg_source_video_pts(line_v6, 1), None);

        let line_v6_stream2 = "[vist#0:2/h264] demuxer -> ist_index:0:2 type:video pkt_pts:2000 pkt_pts_time:4.500 pkt_dts:1958";
        assert_eq!(parse_ffmpeg_source_video_pts(line_v6_stream2, 2), Some(4.5));
    }

    #[test]
    fn parses_video_track_fragment_pts_instead_of_audio_track() {
        let mut tkhd_payload = vec![0; 16];
        tkhd_payload[12..16].copy_from_slice(&2u32.to_be_bytes());
        let tkhd = mp4_box(b"tkhd", tkhd_payload);

        let mut mdhd_payload = vec![0; 16];
        mdhd_payload[12..16].copy_from_slice(&1000u32.to_be_bytes());
        let mdhd = mp4_box(b"mdhd", mdhd_payload);
        let mut hdlr_payload = vec![0; 12];
        hdlr_payload[8..12].copy_from_slice(b"vide");
        let hdlr = mp4_box(b"hdlr", hdlr_payload);
        let mdia = mp4_box(b"mdia", [mdhd, hdlr].concat());
        let trak = mp4_box(b"trak", [tkhd, mdia].concat());
        let moov = mp4_box(b"moov", trak);

        let mut tfhd_payload = vec![0; 8];
        tfhd_payload[4..8].copy_from_slice(&2u32.to_be_bytes());
        let tfhd = mp4_box(b"tfhd", tfhd_payload);
        let mut tfdt_payload = vec![0; 8];
        tfdt_payload[4..8].copy_from_slice(&9000u32.to_be_bytes());
        let tfdt = mp4_box(b"tfdt", tfdt_payload);
        let mut trun_payload = vec![0; 12];
        trun_payload[1..4].copy_from_slice(&[0, 0x08, 0]);
        trun_payload[4..8].copy_from_slice(&1u32.to_be_bytes());
        trun_payload[8..12].copy_from_slice(&1000u32.to_be_bytes());
        let trun = mp4_box(b"trun", trun_payload);
        let traf = mp4_box(b"traf", [tfhd, tfdt, trun].concat());
        let moof = mp4_box(b"moof", traf);

        let mut startup = [mp4_box(b"ftyp", vec![]), moov, moof].concat();
        startup.extend_from_slice(&100u32.to_be_bytes());
        startup.extend_from_slice(b"mdat");
        assert_eq!(extract_mp4_output_reference_pts(&startup), Some(10.0));
    }
}

async fn handle_remux(
    State(state): State<ProxyState>,
    Query(query): Query<RemuxQuery>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let source = resolve_source_url(&state, &query.url);
    let is_network = source.starts_with("http://") || source.starts_with("https://");
    let ffmpeg_path = match ffmpeg_resolver::get_ffmpeg_path() {
        Ok(p) => p,
        Err(e) => {
            eprintln!(
                "[remux] FFmpeg not found ({}), streaming directly via proxy",
                e
            );
            if !is_network {
                let path = PathBuf::from(&source);
                return serve_local_file(&path, headers.get(header::RANGE)).await;
            }
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
            return builder
                .body(body)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    if let Some(ref sid) = query.session_id {
        state.remux_infos.lock().await.remove(sid);
    }

    let mut cmd = tokio::process::Command::new(&ffmpeg_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    if let Some(parent) = ffmpeg_path.parent().filter(|p| !p.as_os_str().is_empty()) {
        cmd.current_dir(parent);
        crate::ffmpeg_resolver::prepend_to_path_tokio(&mut cmd, parent);
    }

    let is_transcode = query.mode.as_deref() == Some("transcode");
    if is_transcode {
        cmd.arg("-v").arg("error");
    } else {
        // Capture the timestamp of the packet used by this exact FFmpeg process.
        // A separate ffprobe seek can land on a different keyframe.
        cmd.arg("-hide_banner")
            .arg("-loglevel")
            .arg("info")
            .arg("-debug_ts");
    }
    let seek_start = query.start.filter(|&s| s > 0.05);
    if let Some(start) = seek_start {
        if !is_transcode {
            cmd.arg("-noaccurate_seek");
        }
        cmd.arg("-ss").arg(format!("{:.3}", start));
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

    let headers_map = collect_request_headers(
        &query.referer,
        &query.ua,
        &query.origin,
        &query.headers,
    );
    let mut headers_str = Vec::new();
    for (k, v) in &headers_map {
        headers_str.push(format!(
            "{}: {}",
            k.replace(['\r', '\n'], ""),
            v.replace(['\r', '\n'], "")
        ));
    }
    if is_network && !headers_str.is_empty() {
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
        let video_codec = query
            .video_codec
            .as_deref()
            .unwrap_or_default()
            .to_lowercase();
        if video_codec.contains("hevc") || video_codec.contains("h265") {
            // Safari/WebKit requires Apple's hvc1 sample-entry tag for HEVC
            // inside MP4. FFmpeg otherwise commonly preserves/writes hev1.
            cmd.arg("-tag:v").arg("hvc1");
        }
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
            audio_filters.push(format!(
                "adelay={}|{}:all=1",
                audio_delay_val as i64, audio_delay_val as i64
            ));
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
        .arg("frag_keyframe+empty_moov+default_base_moof+cmaf")
        .arg("pipe:1");

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        eprintln!("[remux] Failed to spawn FFmpeg: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let stderr = child.stderr.take();
    let video_stream_index = v_idx_opt.unwrap_or(0);
    let (source_pts_sender, source_pts_receiver) = tokio::sync::oneshot::channel::<f64>();
    if let Some(err_pipe) = stderr {
        tokio::spawn(async move {
            let mut lines = BufReader::new(err_pipe).lines();
            let mut sender = Some(source_pts_sender);
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(pts) = parse_ffmpeg_source_video_pts(&line, video_stream_index) {
                    if let Some(tx) = sender.take() {
                        let _ = tx.send(pts);
                    }
                }
            }
        });
    }

    let mut initial_bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut output_reference_pts = None;

    while initial_bytes.len() < 4 * 1024 * 1024 {
        match tokio::time::timeout(std::time::Duration::from_secs(3), stdout.read(&mut chunk)).await
        {
            Ok(Ok(n)) if n > 0 => {
                initial_bytes.extend_from_slice(&chunk[..n]);
                if let Some(pts) = extract_mp4_output_reference_pts(&initial_bytes) {
                    output_reference_pts = Some(pts);
                    break;
                }
            }
            _ => break,
        }
    }

    let session_id_opt = query.session_id.clone();
    let generation = query.generation.unwrap_or(0);
    let requested_start = query.start.unwrap_or(0.0);
    let mut source_reference_pts = if is_transcode {
        // Input seeking is accurate when video is decoded; the first output frame
        // represents the requested source position.
        Some(requested_start)
    } else {
        tokio::time::timeout(std::time::Duration::from_secs(5), source_pts_receiver)
            .await
            .ok()
            .and_then(Result::ok)
    };

    if source_reference_pts.is_none() && requested_start <= 0.05 {
        source_reference_pts = Some(0.0);
    }
    if output_reference_pts.is_none() && requested_start <= 0.05 {
        output_reference_pts = Some(0.0);
    }
    let remux_infos = state.remux_infos.clone();
    let app_opt = state.app.clone();

    {
        let info = RemuxStreamInfo {
            session_id: session_id_opt.clone().unwrap_or_default(),
            generation,
            requested_start,
            source_reference_pts,
            output_reference_pts,
        };
        if let Some(ref sid) = session_id_opt {
            remux_infos.lock().await.insert(sid.clone(), info.clone());
        }
        if let Some(ref app) = app_opt {
            let _ = app.emit("remux_stream_info", &info);
        }
        eprintln!(
            "[remux] Stream started: gen={}, req={:.3}s, src_pts={:?}, out_pts={:?}, offset={:?}",
            generation,
            requested_start,
            source_reference_pts,
            output_reference_pts,
            source_reference_pts
                .zip(output_reference_pts)
                .map(|(source, output)| source - output)
        );
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

    let init_chunk = if !initial_bytes.is_empty() {
        Some(Bytes::from(initial_bytes))
    } else {
        None
    };

    let body_stream = stream::try_unfold(
        (stdout, child, cancel_rx, init_chunk),
        move |(mut stdout, child, mut cancel_rx, mut init_chunk)| async move {
            if let Some(first) = init_chunk.take() {
                return Ok(Some((first, (stdout, child, cancel_rx, None))));
            }
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
                            Ok(Some((Bytes::from(buffer), (stdout, child, cancel_rx, None))))
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
        .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
        .header(header::ACCEPT_RANGES, "none")
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

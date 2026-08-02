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
    sync::{Arc, Mutex},
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;

pub type LocalFileRegistry = Arc<Mutex<HashMap<String, PathBuf>>>;

#[derive(Clone)]
pub struct ProxyState {
    pub client: Client,
    pub port: u16,
    pub local_files: LocalFileRegistry,
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

pub async fn start_server(local_files: LocalFileRegistry) -> Result<u16, String> {
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
    };

    let app = Router::new()
        .route("/playlist.m3u8", get(handle_proxy))
        .route("/segment.ts", get(handle_segment))
        .route("/local/{token}/{file_name}", get(handle_local_file))
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
        let port = start_server(registry).await.unwrap();

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

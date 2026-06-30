use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use reqwest::Client;
use serde::Deserialize;
use tokio::net::TcpListener;

#[derive(Clone)]
pub struct ProxyState {
    pub client: Client,
    pub port: u16,
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

pub async fn start_server() -> Result<u16, String> {
    let client = Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    println!("[stream_proxy] Starting on port {}", port);

    let state = ProxyState {
        client,
        port,
    };

    let app = Router::new()
        .route("/proxy", get(handle_proxy))
        .route("/segment", get(handle_segment))
        .with_state(state);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[stream_proxy] Server error: {}", e);
        }
    });

    Ok(port)
}

fn encode_url(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>()
}

fn build_request(client: &Client, url: &str, referer: &Option<String>, ua: &Option<String>) -> reqwest::RequestBuilder {
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

fn build_proxy_url(port: u16, target_url: &str, is_playlist: bool, referer: &Option<String>, ua: &Option<String>) -> String {
    let encoded = encode_url(target_url);
    let route = if is_playlist { "proxy" } else { "segment" };
    let mut result = format!("http://127.0.0.1:{}/{}?url={}", port, route, encoded);
    if let Some(ref r) = referer {
        result.push_str(&format!("&referer={}", encode_url(r)));
    }
    if let Some(ref u) = ua {
        result.push_str(&format!("&ua={}", encode_url(u)));
    }
    result
}

async fn handle_proxy(
    State(state): State<ProxyState>,
    Query(query): Query<ProxyQuery>,
) -> Result<Response, StatusCode> {
    let mut attempt = 0;
    let mut response = None;
    while attempt < 3 {
        let req = build_request(&state.client, &query.url, &query.referer, &query.ua);
        match req.send().await {
            Ok(res) => {
                response = Some(res);
                break;
            }
            Err(e) => {
                eprintln!("[stream_proxy] Failed to fetch playlist {} (attempt {}): {}", query.url, attempt + 1, e);
                attempt += 1;
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }

    let response = match response {
        Some(res) => res,
        None => return Err(StatusCode::BAD_GATEWAY),
    };

    let status = response.status();
    if !status.is_success() {
        eprintln!("[stream_proxy] Upstream returned {} for {}", status, query.url);
        return Err(StatusCode::BAD_GATEWAY);
    }

    let text = response.text().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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
                    let is_sub_playlist = resolved.contains(".m3u8") || line.contains("EXT-X-MEDIA");
                    let new_uri = build_proxy_url(state.port, &resolved, is_sub_playlist, &query.referer, &query.ua);
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
            let new_uri = build_proxy_url(state.port, &resolved, is_master, &query.referer, &query.ua);
            new_playlist.push_str(&new_uri);
            new_playlist.push('\n');
        }
    }

    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/vnd.apple.mpegurl")],
        new_playlist,
    ).into_response())
}

async fn handle_segment(
    State(state): State<ProxyState>,
    Query(query): Query<SegmentQuery>,
) -> Result<Response, StatusCode> {
    let mut attempt = 0;
    let mut response = None;
    while attempt < 3 {
        let req = build_request(&state.client, &query.url, &query.referer, &query.ua);
        match req.send().await {
            Ok(res) => {
                response = Some(res);
                break;
            }
            Err(e) => {
                eprintln!("[stream_proxy] Failed to fetch segment {} (attempt {}): {}", query.url, attempt + 1, e);
                attempt += 1;
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }

    let response = match response {
        Some(res) => res,
        None => return Err(StatusCode::BAD_GATEWAY),
    };

    let status = response.status();
    if !status.is_success() {
        eprintln!("[stream_proxy] Segment upstream returned {} for {}", status, query.url);
        return Err(StatusCode::BAD_GATEWAY);
    }

    let content_type = response.headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/MP2T")
        .to_string();

    let bytes = response.bytes().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut data = bytes.to_vec();

    // Only attempt MPEG-TS sanitization if the file is not obviously an MP4/M4S file
    // fMP4 segments do not use MPEG-TS packets, and scanning them could corrupt them.
    let url_lower = query.url.to_lowercase();
    let is_mp4 = url_lower.contains(".mp4") || url_lower.contains(".m4s") || url_lower.contains(".m4v") || url_lower.contains(".m4a");

    if !is_mp4 {
        // Scan for the first valid MPEG-TS packet (starts with 0x47 and has another 0x47 188 bytes later)
        for i in 0..data.len() {
            if data[i] == 0x47 && i + 188 < data.len() && data[i + 188] == 0x47 {
                if i > 0 {
                    data = data[i..].to_vec();
                }
                break;
            }
        }
    }
    
    // If not found, just return original (might not be MPEG-TS or might be too short)



    Ok((
        [(axum::http::header::CONTENT_TYPE, content_type)],
        data,
    ).into_response())
}

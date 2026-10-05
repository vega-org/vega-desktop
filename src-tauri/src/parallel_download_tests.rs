use super::*;
use axum::body::{Body, Bytes};
use axum::extract::State as AxumState;
use axum::http::HeaderMap;
use axum::routing::get;
use axum::Router;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Server {
    data: Vec<u8>,
    ranges: bool,
    limit: Option<usize>,
    active: AtomicUsize,
    max_active: AtomicUsize,
    requests: AtomicUsize,
}

struct ActiveGuard(Arc<Server>);

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

async fn serve(
    AxumState(server): AxumState<Arc<Server>>,
    headers: HeaderMap,
) -> axum::response::Response {
    server.requests.fetch_add(1, Ordering::SeqCst);
    let len = server.data.len() as u64;
    let range = headers
        .get("range")
        .filter(|_| server.ranges)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("bytes="))
        .and_then(|value| value.split_once('-'))
        .map(|(start, end)| {
            let start: u64 = start.parse().unwrap();
            let end: u64 = if end.is_empty() { len - 1 } else { end.parse().unwrap() };
            (start, end.min(len - 1) + 1)
        });
    let active = server.active.fetch_add(1, Ordering::SeqCst) + 1;
    let guard = ActiveGuard(server.clone());
    if server.limit.is_some_and(|limit| active > limit) {
        return axum::response::Response::builder()
            .status(429)
            .body(Body::empty())
            .unwrap();
    }
    server.max_active.fetch_max(active, Ordering::SeqCst);
    let (start, end, status) = match range {
        Some((start, end)) => (start, end, 206),
        None => (0, len, 200),
    };
    if start >= len {
        return axum::response::Response::builder()
            .status(416)
            .header("content-range", format!("bytes */{len}"))
            .body(Body::empty())
            .unwrap();
    }
    let mut builder = axum::response::Response::builder()
        .status(status)
        .header("content-length", end - start)
        .header("etag", "\"v1\"");
    if status == 206 {
        builder = builder.header("content-range", format!("bytes {}-{}/{}", start, end - 1, len));
    }
    // About 32 MB/s per connection.
    let stream = futures_util::stream::unfold(
        (server, start, guard),
        move |(server, pos, guard)| async move {
            if pos >= end {
                return None;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
            let next = (pos + 65536).min(end);
            let chunk = Bytes::copy_from_slice(&server.data[pos as usize..next as usize]);
            Some((Ok::<_, std::io::Error>(chunk), (server, next, guard)))
        },
    );
    builder.body(Body::from_stream(stream)).unwrap()
}

fn test_data(len: usize) -> Vec<u8> {
    let mut state = 0x2545_f491_4f6c_dd1du64;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state as u8
        })
        .collect()
}

struct Harness {
    runtime: tokio::runtime::Runtime,
    server: Arc<Server>,
    url: String,
    dir: PathBuf,
}

impl Harness {
    fn new(name: &str, ranges: bool, limit: Option<usize>) -> Self {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        let server = Arc::new(Server {
            data: test_data(32 * 1024 * 1024),
            ranges,
            limit,
            active: AtomicUsize::new(0),
            max_active: AtomicUsize::new(0),
            requests: AtomicUsize::new(0),
        });
        let state = server.clone();
        let url = runtime.block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let app = Router::new().route("/file", get(serve)).with_state(state);
            tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            format!("http://{address}/file")
        });
        let dir = std::env::temp_dir().join(format!("vega-parallel-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self {
            runtime,
            server,
            url,
            dir,
        }
    }

    fn part(&self) -> PathBuf {
        self.dir.join("video.part")
    }

    fn download(&self, pause_after: Option<Duration>) -> Result<Outcome, String> {
        let client = Client::new();
        self.runtime.block_on(async {
            let (cancel_tx, mut cancel_rx) = mpsc::channel(1);
            if let Some(delay) = pause_after {
                let sender = cancel_tx.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(delay).await;
                    let _ = sender.send(()).await;
                });
            }
            let result = download(&|_, _, _, _| {}, &client, &self.url, &self.part(), 8, &mut cancel_rx).await;
            drop(cancel_tx);
            result
        })
    }

    fn assert_complete(&self) {
        let written = std::fs::read(self.part()).unwrap();
        assert!(written == self.server.data, "downloaded bytes differ from the source");
        assert!(!state_path(&self.part()).exists());
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn downloads_over_several_connections() {
    let harness = Harness::new("parallel", true, None);
    assert!(matches!(harness.download(None), Ok(Outcome::Completed)));
    harness.assert_complete();
    assert!(harness.server.max_active.load(Ordering::SeqCst) > 1);
    // Long ranges: a few requests, not one per chunk.
    assert!(harness.server.requests.load(Ordering::SeqCst) < 30);
}

#[test]
fn rate_limited_server_still_completes() {
    let harness = Harness::new("limited", true, Some(2));
    assert!(matches!(harness.download(None), Ok(Outcome::Completed)));
    harness.assert_complete();
}

#[test]
fn resumes_after_pause() {
    let harness = Harness::new("resume", true, None);
    assert!(matches!(
        harness.download(Some(Duration::from_millis(300))),
        Ok(Outcome::Paused)
    ));
    assert!(state_path(&harness.part()).exists());
    let requests_before = harness.server.requests.load(Ordering::SeqCst);
    assert!(matches!(harness.download(None), Ok(Outcome::Completed)));
    harness.assert_complete();
    assert!(harness.server.requests.load(Ordering::SeqCst) > requests_before);
}

#[test]
fn server_without_ranges_uses_one_connection() {
    let harness = Harness::new("no-ranges", false, None);
    assert!(matches!(harness.download(None), Ok(Outcome::Completed)));
    harness.assert_complete();
    assert_eq!(harness.server.max_active.load(Ordering::SeqCst), 1);
}

#[test]
fn continues_a_single_connection_partial_file() {
    let harness = Harness::new("legacy", true, None);
    std::fs::write(harness.part(), &harness.server.data[..5_000_000]).unwrap();
    assert!(matches!(harness.download(None), Ok(Outcome::Completed)));
    harness.assert_complete();
}

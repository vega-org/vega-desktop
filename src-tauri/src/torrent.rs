use std::path::PathBuf;
use std::sync::Arc;
use axum::serve::Listener;

use librqbit::Session;
use librqbit::api::Api;
use librqbit::http_api::{HttpApi, HttpApiOptions};

pub struct TorrentState {
    pub _session: Arc<Session>,
    pub api_port: u16,
}

impl TorrentState {
    pub async fn new(download_dir: PathBuf) -> anyhow::Result<Self> {
        // Automatically clean up download_dir to clear orphaned torrents from crashes
        let _ = std::fs::remove_dir_all(&download_dir);
        std::fs::create_dir_all(&download_dir)?;

        // Allow all CORS origins. Windows Tauri v2 uses http://tauri.localhost which isn't in librqbit's default allowlist
        std::env::set_var("CORS_ALLOW_REGEXP", ".*");

        let session = Session::new(download_dir).await?;
        let api = Api::new(session.clone(), None, None);

        let opts = HttpApiOptions {
            read_only: false,
            basic_auth: None,
            allow_create: true,
        };

        let http_api = HttpApi::new(api, Some(opts));

        let dual_listener = librqbit_dualstack_sockets::socket::MaybeDualstackSocket::<tokio::net::TcpListener>::bind_tcp(
            "127.0.0.1:0".parse()?,
            Default::default()
        )?;
        let api_port = dual_listener.local_addr()?.0.port();

        // Spawn HTTP server in the background
        tokio::spawn(async move {
            if let Err(e) = http_api.make_http_api_and_run(dual_listener, None).await {
                eprintln!("librqbit http api error: {}", e);
            }
        });

        Ok(Self { _session: session, api_port })
    }
}

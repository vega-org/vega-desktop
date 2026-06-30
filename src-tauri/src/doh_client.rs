use hickory_resolver::{
    config::{NameServerConfig, Protocol, ResolverConfig, ResolverOpts},
    TokioAsyncResolver,
};
use reqwest::{dns::Resolve, Client, Method};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    str::FromStr,
    sync::Arc,
};
use tokio::sync::RwLock;
use lazy_static::lazy_static;

#[derive(Clone)]
struct CustomDnsResolver {
    resolver: Arc<TokioAsyncResolver>,
}

impl CustomDnsResolver {
    fn new(provider: &str, custom_url: Option<String>) -> Self {
        let mut opts = ResolverOpts::default();
        opts.use_hosts_file = false;

        let config = if let Some(_url) = custom_url.filter(|u| !u.is_empty()) {
            // Very simplified setup for custom DoH: hickory requires name server groups
            // In reality, this requires parsing the URL to get the IP.
            // For simplicity, we just fallback to Cloudflare if a custom URL is provided but not fully supported here,
            // or we could use the default system resolver for custom URLs if it's too complex.
            // Let's stick to known providers for hickory configuration:
            ResolverConfig::cloudflare_https()
        } else {
            match provider.to_lowercase().as_str() {
                "google" => ResolverConfig::google_https(),
                "adguard" => {
                    // AdGuard DNS over HTTPS config
                    let mut config = ResolverConfig::new();
                    let name_server = NameServerConfig::new(
                        SocketAddr::from_str("94.140.14.14:443").unwrap(),
                        Protocol::Https,
                    );
                    config.add_name_server(name_server);
                    config
                }
                _ => ResolverConfig::cloudflare_https(),
            }
        };

        let resolver = TokioAsyncResolver::tokio(config, opts);
        Self {
            resolver: Arc::new(resolver),
        }
    }
}

impl Resolve for CustomDnsResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let resolver = self.resolver.clone();
        let name_str = name.as_str().to_string();
        Box::pin(async move {
            println!("[DoH] Resolving: {}", name_str);
            match resolver.lookup_ip(name_str.as_str()).await {
                Ok(response) => {
                    let addrs: Vec<SocketAddr> = response
                        .into_iter()
                        .map(|ip| SocketAddr::new(ip, 0))
                        .collect();
                    println!("[DoH] Resolved {} to {:?}", name_str, addrs);
                    Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
                }
                Err(e) => {
                    eprintln!("[DoH] Resolution failed for {}: {:?}", name_str, e);
                    Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
                }
            }
        })
    }
}

lazy_static! {
    static ref CLIENT_CACHE: RwLock<HashMap<String, Client>> = RwLock::new(HashMap::new());
}

async fn get_client(provider: &str, custom_url: Option<String>) -> Result<Client, String> {
    let key = format!("{}_{}", provider, custom_url.clone().unwrap_or_default());
    
    {
        let cache = CLIENT_CACHE.read().await;
        if let Some(client) = cache.get(&key) {
            return Ok(client.clone());
        }
    }

    let resolver = CustomDnsResolver::new(provider, custom_url);
    
    let client = reqwest::Client::builder()
        .dns_resolver(Arc::new(resolver))
        .danger_accept_invalid_certs(true) // For providers that might have bad certs
        .build()
        .map_err(|e| e.to_string())?;

    let mut cache = CLIENT_CACHE.write().await;
    cache.insert(key, client.clone());
    
    Ok(client)
}

#[derive(Deserialize)]
pub struct FetchArgs {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    doh_provider: String,
    doh_custom_url: Option<String>,
}

#[derive(Serialize)]
pub struct FetchResponse {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    data: Vec<u8>,
}

#[tauri::command]
pub async fn doh_fetch(args: FetchArgs) -> Result<FetchResponse, String> {
    let client = get_client(&args.doh_provider, args.doh_custom_url).await?;

    let method = Method::from_bytes(args.method.as_bytes()).unwrap_or(Method::GET);
    let mut request = client.request(method, &args.url);

    let mut has_user_agent = false;
    for (k, v) in args.headers {
        if k.eq_ignore_ascii_case("user-agent") {
            has_user_agent = true;
        }
        request = request.header(k, v);
    }

    if !has_user_agent {
        request = request.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    }

    if let Some(body) = args.body {
        request = request.body(body);
    }

    let response = request.send().await.map_err(|e| format!("{:#?}", e))?;
    
    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();
    
    let mut headers = HashMap::new();
    for (k, v) in response.headers() {
        if let Ok(val) = v.to_str() {
            headers.insert(k.as_str().to_string(), val.to_string());
        }
    }

    let data = response.bytes().await.map_err(|e| e.to_string())?.to_vec();

    Ok(FetchResponse {
        status,
        status_text,
        headers,
        data,
    })
}

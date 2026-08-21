use hickory_resolver::{
    config::{NameServerConfig, Protocol, ResolverConfig, ResolverOpts},
    TokioAsyncResolver,
};
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::SocketAddr, str::FromStr, sync::Arc};
use tokio::sync::RwLock;
use wreq::{dns::Resolve, redirect::Policy, Client, Method};
use wreq_util::Emulation;

#[derive(Clone)]
struct CustomDnsResolver {
    resolver: Arc<TokioAsyncResolver>,
}

impl CustomDnsResolver {
    fn new(provider: &str, custom_url: Option<String>) -> Self {
        let mut opts = ResolverOpts::default();
        opts.use_hosts_file = true;
        opts.ip_strategy = hickory_resolver::config::LookupIpStrategy::Ipv4AndIpv6;

        let config = if let Some(url) = custom_url.filter(|u| !u.is_empty()) {
            if url.to_lowercase().contains("google") {
                ResolverConfig::google_https()
            } else if url.to_lowercase().contains("adguard") {
                let mut config = ResolverConfig::new();
                let name_server = NameServerConfig::new(
                    SocketAddr::from_str("94.140.14.14:443").unwrap(),
                    Protocol::Https,
                );
                config.add_name_server(name_server);
                config
            } else if url.to_lowercase().contains("quad9") {
                ResolverConfig::quad9_https()
            } else {
                ResolverConfig::cloudflare_https()
            }
        } else {
            match provider.to_lowercase().as_str() {
                "google" => ResolverConfig::google_https(),
                "adguard" => {
                    let mut config = ResolverConfig::new();
                    let name_server = NameServerConfig::new(
                        SocketAddr::from_str("94.140.14.14:443").unwrap(),
                        Protocol::Https,
                    );
                    config.add_name_server(name_server);
                    config
                }
                "quad9" => ResolverConfig::quad9_https(),
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
    fn resolve(&self, name: wreq::dns::Name) -> wreq::dns::Resolving {
        let resolver = self.resolver.clone();
        let name_str = name.as_str().to_string();
        Box::pin(async move {
            // Direct IP addresses (v4 or v6) do not need DNS lookup
            if let Ok(ip) = name_str.parse::<std::net::IpAddr>() {
                return Ok(Box::new(std::iter::once(SocketAddr::new(ip, 0))) as wreq::dns::Addrs);
            }

            // Localhost bypass
            if name_str.eq_ignore_ascii_case("localhost") {
                let local_addrs = vec![
                    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0),
                ];
                return Ok(Box::new(local_addrs.into_iter()) as wreq::dns::Addrs);
            }

            println!("[DoH] Resolving: {}", name_str);
            match resolver.lookup_ip(name_str.as_str()).await {
                Ok(response) => {
                    let addrs: Vec<SocketAddr> = response
                        .into_iter()
                        .map(|ip| SocketAddr::new(ip, 0))
                        .collect();
                    println!("[DoH] Resolved {} to {:?}", name_str, addrs);
                    Ok(Box::new(addrs.into_iter()) as wreq::dns::Addrs)
                }
                Err(e) => {
                    eprintln!(
                        "[DoH] DoH resolution failed for {}: {:?}. Falling back to system DNS...",
                        name_str, e
                    );
                    match tokio::net::lookup_host(format!("{}:0", name_str)).await {
                        Ok(std_addrs) => {
                            let addrs: Vec<SocketAddr> = std_addrs.collect();
                            println!("[DoH] System DNS resolved {} to {:?}", name_str, addrs);
                            Ok(Box::new(addrs.into_iter()) as wreq::dns::Addrs)
                        }
                        Err(sys_err) => {
                            eprintln!(
                                "[DoH] System DNS also failed for {}: {:?}",
                                name_str, sys_err
                            );
                            Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
                        }
                    }
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

    let mut builder = Client::builder()
        .emulation(Emulation::Chrome137)
        .cookie_store(true)
        .redirect(Policy::limited(10));

    if !provider.eq_ignore_ascii_case("system") && !provider.eq_ignore_ascii_case("none") {
        let resolver = CustomDnsResolver::new(provider, custom_url);
        builder = builder.dns_resolver(Arc::new(resolver));
    }

    let client = builder
        .build()
        .map_err(|e| format!("Failed to build wreq client: {:#?}", e))?;

    let mut cache = CLIENT_CACHE.write().await;
    cache.insert(key, client.clone());

    Ok(client)
}

#[derive(Deserialize, Debug)]
#[serde(untagged)]
pub enum FetchBody {
    Text(String),
    Bytes(Vec<u8>),
}

#[derive(Deserialize, Debug)]
pub struct FetchArgs {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<FetchBody>,
    #[serde(default)]
    pub max_redirects: Option<usize>,
    #[serde(default = "default_doh_provider")]
    pub doh_provider: String,
    #[serde(default)]
    pub doh_custom_url: Option<String>,
}

fn default_method() -> String {
    "GET".to_string()
}

fn default_doh_provider() -> String {
    "cloudflare".to_string()
}

#[derive(Serialize)]
pub struct FetchResponse {
    status: u16,
    status_text: String,
    url: String,
    headers: Vec<(String, String)>,
    data: Vec<u8>,
}

#[tauri::command]
pub async fn doh_fetch(args: FetchArgs) -> Result<FetchResponse, String> {
    let has_cookie = args
        .headers
        .keys()
        .any(|k| k.eq_ignore_ascii_case("cookie"));
    println!(
        "[doh_fetch] {} {} | has_cookie: {}",
        args.method, args.url, has_cookie
    );

    let client = get_client(&args.doh_provider, args.doh_custom_url).await?;

    let method = Method::from_bytes(args.method.as_bytes()).unwrap_or(Method::GET);
    let mut request = client.request(method, &args.url);

    if let Some(max_redirects) = args.max_redirects {
        let redirect_policy = if max_redirects == 0 {
            Policy::none()
        } else {
            Policy::limited(max_redirects)
        };
        request = request.redirect(redirect_policy);
    }

    for (k, v) in &args.headers {
        if k.eq_ignore_ascii_case("accept-encoding") {
            continue;
        }
        request = request.header(k, v);
    }

    if let Some(body) = args.body {
        request = match body {
            FetchBody::Text(text) => request.body(text),
            FetchBody::Bytes(bytes) => request.body(bytes),
        };
    }

    let response = request.send().await.map_err(|e| {
        eprintln!("[doh_fetch] request error for {}: {:#?}", args.url, e);
        format!("{:#?}", e)
    })?;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let response_url = response.url().to_string();
    println!(
        "[doh_fetch] response: {} {} for {}",
        status, status_text, args.url
    );

    let mut headers = Vec::new();
    for (k, v) in response.headers() {
        if let Ok(val) = v.to_str() {
            headers.push((k.as_str().to_string(), val.to_string()));
        }
    }

    let data = response.bytes().await.map_err(|e| e.to_string())?.to_vec();

    Ok(FetchResponse {
        status,
        status_text,
        url: response_url,
        headers,
        data,
    })
}

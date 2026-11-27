use hickory_resolver::{
    config::{NameServerConfig, Protocol, ResolverConfig, ResolverOpts},
    TokioAsyncResolver,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::{IpAddr, SocketAddr}, str::FromStr, sync::Arc};
use std::time::{Duration, Instant};
use crate::nat64::{Nat64Prefix, order_addresses};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tokio::sync::RwLock;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use wreq::{dns::Resolve, redirect::Policy, Client, Method};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use wreq_util::Emulation;

lazy_static::lazy_static! {
    static ref NAT64_CACHE: tokio::sync::RwLock<Option<(Instant, Vec<Nat64Prefix>)>> = tokio::sync::RwLock::new(None);
    static ref NAT64_REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::new(());
    static ref RESOLVER_CACHE: std::sync::RwLock<HashMap<String, Arc<TokioAsyncResolver>>> = std::sync::RwLock::new(HashMap::new());
}

/// Discover the network's DNS64 prefix without resolving provider names through ISP DNS.
/// The original DoH IPv4 addresses remain the destinations after NAT64 translation.
pub async fn network_addresses(ips: Vec<IpAddr>) -> Vec<IpAddr> {
    {
        let cache = NAT64_CACHE.read().await;
        if let Some((time, prefixes)) = &*cache {
            if time.elapsed() < Duration::from_secs(60) {
                return order_addresses(ips, prefixes);
            }
        }
    }
    let _guard = NAT64_REFRESH_LOCK.lock().await;
    {
        let cache = NAT64_CACHE.read().await;
        if let Some((time, prefixes)) = &*cache {
            if time.elapsed() < Duration::from_secs(60) {
                return order_addresses(ips, prefixes);
            }
        }
    }
    let addresses = tokio::time::timeout(
        Duration::from_millis(1500), tokio::net::lookup_host("ipv4only.arpa:0")
    ).await;
    let mut prefixes = Vec::new();
    if let Ok(Ok(addresses)) = addresses {
        for address in addresses {
            if let IpAddr::V6(ip) = address.ip() {
                if let Some(prefix) = Nat64Prefix::from_discovery_address(ip) {
                    if !prefixes.contains(&prefix) {
                        prefixes.push(prefix);
                    }
                }
            }
        }
    }
    *NAT64_CACHE.write().await = Some((Instant::now(), prefixes.clone()));
    order_addresses(ips, &prefixes)
}

pub fn build_hickory_resolver(provider: &str, custom_url: Option<String>) -> TokioAsyncResolver {
    let mut opts = ResolverOpts::default();
    opts.use_hosts_file = true;
    opts.ip_strategy = hickory_resolver::config::LookupIpStrategy::Ipv4AndIpv6;
    opts.num_concurrent_reqs = 2;
    opts.timeout = Duration::from_secs(3);
    opts.attempts = 2;
    opts.cache_size = 256;

    let config = if let Some(url) = custom_url.filter(|u| !u.is_empty()) {
        if url.to_lowercase().contains("google") {
            ResolverConfig::google_https()
        } else if url.to_lowercase().contains("adguard") {
            let mut config = ResolverConfig::new();
            if let Ok(addr) = SocketAddr::from_str("94.140.14.14:443") {
                config.add_name_server(NameServerConfig::new(addr, Protocol::Https));
            }
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
                if let Ok(addr) = SocketAddr::from_str("94.140.14.14:443") {
                    config.add_name_server(NameServerConfig::new(addr, Protocol::Https));
                }
                config
            }
            "quad9" => ResolverConfig::quad9_https(),
            _ => ResolverConfig::cloudflare_https(),
        }
    };

    TokioAsyncResolver::tokio(config, opts)
}

#[derive(Clone)]
struct CustomDnsResolver {
    resolver: Arc<TokioAsyncResolver>,
    public_only: bool,
    system: bool,
}

impl CustomDnsResolver {
    fn new(provider: &str, custom_url: Option<String>) -> Self {
        let system = provider.eq_ignore_ascii_case("system") || provider.eq_ignore_ascii_case("none");
        let key = format!(
            "{}_{}",
            provider.to_lowercase(),
            custom_url.as_deref().unwrap_or_default()
        );
        let resolver = if let Some(cached) = RESOLVER_CACHE
            .read()
            .ok()
            .and_then(|cache| cache.get(&key).cloned())
        {
            cached
        } else {
            let created = Arc::new(build_hickory_resolver(provider, custom_url));
            if let Ok(mut cache) = RESOLVER_CACHE.write() {
                cache.entry(key).or_insert_with(|| created.clone()).clone()
            } else {
                created
            }
        };
        Self {
            resolver,
            public_only: false,
            system,
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl Resolve for CustomDnsResolver {
    fn resolve(&self, name: wreq::dns::Name) -> wreq::dns::Resolving {
        let resolver = self.resolver.clone();
        let name_str = name.as_str().to_string();
        let public_only = self.public_only;
        let system = self.system;
        Box::pin(async move {
            // Direct IP addresses (v4 or v6) do not need DNS lookup
            if let Ok(ip) = name_str.parse::<std::net::IpAddr>() {
                if public_only { crate::public_network::validate_addresses(&[ip])?; }
                return Ok(Box::new(std::iter::once(SocketAddr::new(ip, 0))) as wreq::dns::Addrs);
            }

            // Localhost bypass
            if name_str.eq_ignore_ascii_case("localhost") {
                if public_only { return Err("Provider localhost access is blocked".into()); }
                let local_addrs = vec![
                    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0),
                ];
                return Ok(Box::new(local_addrs.into_iter()) as wreq::dns::Addrs);
            }

            vlog_debug!("[DoH] Resolving: {}", name_str);
            if public_only && system {
                let mut addresses: Vec<_> = tokio::net::lookup_host((name_str.as_str(), 0)).await?.collect();
                crate::public_network::validate_addresses(&addresses.iter().map(|a| a.ip()).collect::<Vec<_>>())?;
                addresses.sort_by_key(|a| !a.ip().is_ipv4());
                return Ok(Box::new(addresses.into_iter()) as wreq::dns::Addrs);
            }
            match resolver.lookup_ip(name_str.as_str()).await {
                Ok(response) => {
                    let mut resolved: Vec<_> = response.into_iter().collect();
                    if public_only { crate::public_network::validate_addresses(&resolved)?; }
                    resolved.sort_by_key(|ip| !ip.is_ipv4());
                    let ips = network_addresses(resolved).await;
                    let addrs: Vec<SocketAddr> = ips.into_iter().map(|ip| SocketAddr::new(ip, 0)).collect();
                    vlog_debug!("[DoH] Resolved {} to {:?}", name_str, addrs);
                    Ok(Box::new(addrs.into_iter()) as wreq::dns::Addrs)
                }
                Err(e) => {
                    vlog_warn!(
                        "[DoH] DoH resolution failed for {}: {:?}. Falling back to system DNS...",
                        name_str, e
                    );
                    match tokio::net::lookup_host(format!("{}:0", name_str)).await {
                        Ok(std_addrs) => {
                            let mut addrs: Vec<SocketAddr> = std_addrs.collect();
                            if public_only { crate::public_network::validate_addresses(&addrs.iter().map(|a| a.ip()).collect::<Vec<_>>())?; }
                            addrs.sort_by_key(|a| !a.ip().is_ipv4());
                            vlog_debug!("[DoH] System DNS resolved {} to {:?}", name_str, addrs);
                            Ok(Box::new(addrs.into_iter()) as wreq::dns::Addrs)
                        }
                        Err(sys_err) => {
                            vlog_warn!(
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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
lazy_static! {
    static ref CLIENT_CACHE: RwLock<HashMap<String, Client>> = RwLock::new(HashMap::new());
}

pub async fn clear_client_cache() {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let mut cache = CLIENT_CACHE.write().await;
        cache.clear();
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn get_client(
    provider: &str,
    custom_url: Option<String>,
    cookie_store: bool,
) -> Result<Client, String> {
    let public_only = !cookie_store;
    let active_proxy = if public_only { crate::proxy_manager::get_checked_provider_proxy_url().await? }
        else { crate::proxy_manager::get_active_proxy_url().await };
    let key = format!(
        "{}_{}_{}_{}",
        cookie_store,
        provider,
        custom_url.clone().unwrap_or_default(),
        active_proxy.as_deref().unwrap_or_default()
    );

    {
        let cache = CLIENT_CACHE.read().await;
        if let Some(client) = cache.get(&key) {
            return Ok(client.clone());
        }
    }

    let mut builder = Client::builder()
        .emulation(Emulation::Chrome137)
        .cookie_store(cookie_store)
        .redirect(Policy::limited(10));

    if let Some(ref proxy_url) = active_proxy {
        match wreq::Proxy::all(proxy_url) {
            Ok(proxy) => {
                builder = builder.proxy(proxy);
            }
            Err(e) => {
                vlog_warn!("[doh_client] Failed to configure proxy {}: {:?}", proxy_url, e);
            }
        }
    }

    if active_proxy.is_none()
        && (public_only || (!provider.eq_ignore_ascii_case("system") && !provider.eq_ignore_ascii_case("none")))
    {
        let mut resolver = CustomDnsResolver::new(provider, custom_url);
        resolver.public_only = public_only;
        builder = builder.dns_resolver(Arc::new(resolver));
    }
    if public_only { builder = builder.timeout(Duration::from_secs(30)).connect_timeout(Duration::from_secs(20)); }

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
    /// Provider requests: skip the shared cookie store. Provider cookies are
    /// kept per source author on the JS side and sent as a Cookie header.
    #[serde(default)]
    pub isolated_cookies: bool,
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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn doh_fetch(args: FetchArgs) -> Result<FetchResponse, String> {
    if args.isolated_cookies { crate::public_network::validate_url(&args.url)?; }
    let has_cookie = args
        .headers
        .keys()
        .any(|k| k.eq_ignore_ascii_case("cookie"));
    vlog_debug!(
        "[doh_fetch] {} {} | has_cookie: {}",
        args.method, args.url, has_cookie
    );

    let client = get_client(
        &args.doh_provider,
        args.doh_custom_url,
        !args.isolated_cookies,
    )
    .await?;

    let method = Method::from_bytes(args.method.as_bytes()).unwrap_or(Method::GET);
    let mut request = client.request(method, &args.url);

    if args.isolated_cookies {
        let limit = args.max_redirects.unwrap_or(10).min(10);
        request = request.redirect(Policy::custom(move |attempt| {
            if crate::public_network::validate_url(attempt.url().as_str()).is_err() { return attempt.error("Provider redirect destination is blocked"); }
            if attempt.previous().len() >= limit { return attempt.stop(); }
            attempt.follow()
        }));
    } else if let Some(max_redirects) = args.max_redirects {
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
        vlog_warn!("[doh_fetch] request error for {}: {:#?}", args.url, e);
        format!("{:#?}", e)
    })?;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let response_url = response.url().to_string();
    vlog_debug!(
        "[doh_fetch] response: {} {} for {}",
        status, status_text, args.url
    );

    let mut headers = Vec::new();
    for (k, v) in response.headers() {
        if let Ok(val) = v.to_str() {
            headers.push((k.as_str().to_string(), val.to_string()));
        }
    }

    let data = if args.isolated_cookies {
        let mut response = response;
        let mut data = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if data.len() + chunk.len() > 8 * 1024 * 1024 { return Err("Provider response exceeds 8 MiB".into()); }
            data.extend_from_slice(&chunk);
        }
        data
    } else { response.bytes().await.map_err(|e| e.to_string())?.to_vec() };

    Ok(FetchResponse {
        status,
        status_text,
        url: response_url,
        headers,
        data,
    })
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub async fn doh_fetch(args: FetchArgs) -> Result<FetchResponse, String> {
    let has_cookie = args
        .headers
        .keys()
        .any(|k| k.eq_ignore_ascii_case("cookie"));
    vlog_debug!(
        "[doh_fetch] (mobile) {} {} | has_cookie: {}",
        args.method, args.url, has_cookie
    );

    let parsed_url = url::Url::parse(&args.url).map_err(|e| e.to_string())?;
    let host_str = parsed_url.host_str().unwrap_or("").to_string();

    let mut builder = reqwest::Client::builder()
        .cookie_store(!args.isolated_cookies);

    if let Some(max_redirects) = args.max_redirects {
        if max_redirects == 0 {
            builder = builder.redirect(reqwest::redirect::Policy::none());
        } else {
            builder = builder.redirect(reqwest::redirect::Policy::limited(max_redirects));
        }
    }

    if !args.doh_provider.eq_ignore_ascii_case("system")
        && !args.doh_provider.eq_ignore_ascii_case("none")
        && !host_str.is_empty()
        && host_str.parse::<std::net::IpAddr>().is_err()
        && !host_str.eq_ignore_ascii_case("localhost")
    {
        let resolver = CustomDnsResolver::new(&args.doh_provider, args.doh_custom_url.clone());
        if let Ok(response) = resolver.resolver.lookup_ip(&host_str).await {
            let port = parsed_url.port_or_known_default().unwrap_or(443);
            let addrs: Vec<SocketAddr> = response
                .into_iter()
                .map(|ip| SocketAddr::new(ip, port))
                .collect();
            if !addrs.is_empty() {
                builder = builder.resolve_to_addrs(&host_str, &addrs);
            }
        }
    }

    let client = builder
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {:#?}", e))?;

    let method = reqwest::Method::from_bytes(args.method.as_bytes()).unwrap_or(reqwest::Method::GET);
    let mut request = client.request(method, &args.url);

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
        vlog_warn!("[doh_fetch] (mobile) request error for {}: {:#?}", args.url, e);
        format!("{:#?}", e)
    })?;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let response_url = response.url().to_string();
    vlog_debug!(
        "[doh_fetch] (mobile) response: {} {} for {}",
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

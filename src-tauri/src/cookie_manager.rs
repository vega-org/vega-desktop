use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Serialize)]
pub struct CookieInfo {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub http_only: bool,
    pub secure: bool,
    pub expires: Option<f64>,
}

#[tauri::command]
pub async fn get_cookies_for_url<R: Runtime>(
    app: AppHandle<R>,
    webview_label: String,
    url: String,
) -> Result<Vec<CookieInfo>, String> {
    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    let webview = app
        .get_webview_window(&webview_label)
        .ok_or_else(|| format!("Webview '{}' not found", webview_label))?;

    let cookies = webview
        .cookies_for_url(parsed_url)
        .map_err(|e| e.to_string())?;

    Ok(cookies
        .into_iter()
        .map(|c| CookieInfo {
            name: c.name().to_string(),
            value: c.value().to_string(),
            domain: c.domain().unwrap_or("").to_string(),
            path: c.path().unwrap_or("/").to_string(),
            http_only: c.http_only().unwrap_or(false),
            secure: c.secure().unwrap_or(false),
            expires: c.expires().and_then(|e| e.datetime().map(|dt| dt.unix_timestamp() as f64)),
        })
        .collect())
}

#[tauri::command]
pub async fn clear_cookies_for_url<R: Runtime>(
    app: AppHandle<R>,
    webview_label: String,
    url: String,
) -> Result<(), String> {
    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    let webview = app
        .get_webview_window(&webview_label)
        .ok_or_else(|| format!("Webview '{}' not found", webview_label))?;

    // WebviewWindow allows clearing cookies via clear_all_browsing_data or we can delete cookies individually
    // But since `cookies_for_url` gives us all cookies, we can iterate and delete them
    if let Ok(cookies) = webview.cookies_for_url(parsed_url) {
        for cookie in cookies {
            let _ = webview.delete_cookie(cookie);
        }
    }

    Ok(())
}

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
            expires: c
                .expires()
                .and_then(|e| e.datetime().map(|dt| dt.unix_timestamp() as f64)),
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

const WAF_WEBVIEW_LABEL: &str = "waf-solver";
const WAF_EVAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Runs JavaScript in the WAF solver window and returns the result as a JSON
/// string. The solver window shows a remote site without IPC access, so the
/// dialog uses this to inject provider scripts and read their messages back.
/// Limited to the solver window: it never runs in the main app window.
#[tauri::command]
pub async fn waf_eval<R: Runtime>(app: AppHandle<R>, script: String) -> Result<String, String> {
    let webview = app
        .get_webview_window(WAF_WEBVIEW_LABEL)
        .ok_or_else(|| "WAF window is not open".to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Mutex::new(Some(tx));
    webview
        .eval_with_callback(script, move |result| {
            if let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = tx.send(result);
            }
        })
        .map_err(|e| e.to_string())?;

    tokio::time::timeout(WAF_EVAL_TIMEOUT, rx)
        .await
        .map_err(|_| "WAF script timed out".to_string())?
        .map_err(|_| "WAF window closed".to_string())
}

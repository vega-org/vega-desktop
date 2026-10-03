//! Keeps the newest ~500 KB of Vega logs (~4 MB with detailed logging) on
//! disk so users can export them with a bug report. Same idea as VegaLog on
//! Android: two rotating files, secrets removed before anything is written.
//!
//! Sources: Rust `vlog_*!` macros, the `log` crate (plugins), panics, and
//! the frontend console (`log_write_batch`). Debug lines are kept only while
//! detailed logging is on.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use regex::Regex;

// Two files each, so ~500 KB normally and ~4 MB with detailed logging.
const FILE_LIMIT_BYTES: u64 = 250 * 1024;
const DETAILED_FILE_LIMIT_BYTES: u64 = 2 * 1024 * 1024;
const QUEUE_LIMIT: usize = 5_000;
const MAX_LINE_CHARS: usize = 4_000;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    fn letter(self) -> char {
        match self {
            Level::Debug => 'D',
            Level::Info => 'I',
            Level::Warn => 'W',
            Level::Error => 'E',
        }
    }

    fn from_name(name: &str) -> Level {
        match name {
            "error" => Level::Error,
            "warn" => Level::Warn,
            "info" => Level::Info,
            _ => Level::Debug,
        }
    }
}

static DETAILED: AtomicBool = AtomicBool::new(false);
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static SENDER: OnceLock<SyncSender<String>> = OnceLock::new();
// Serializes file writes between the writer thread, flush and clear.
static FILE_LOCK: Mutex<()> = Mutex::new(());

fn current(dir: &Path) -> PathBuf {
    dir.join("vega-0.log")
}

fn previous(dir: &Path) -> PathBuf {
    dir.join("vega-1.log")
}

/// Starts the writer thread and the panic hook. Call once from setup.
pub fn init(dir: PathBuf) {
    if LOG_DIR.get().is_some() {
        return;
    }
    let _ = fs::create_dir_all(&dir);
    let _ = LOG_DIR.set(dir);

    let (tx, rx) = sync_channel::<String>(QUEUE_LIMIT);
    let _ = SENDER.set(tx);
    std::thread::Builder::new()
        .name("VegaLogWriter".into())
        .spawn(move || write_loop(rx))
        .ok();

    static PLUGIN_LOGGER: PluginLogger = PluginLogger;
    let _ = log::set_logger(&PLUGIN_LOGGER);
    log::set_max_level(log::LevelFilter::Debug);

    let next = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        record(Level::Error, "VegaCrash", &format!("Panic: {info}"));
        flush();
        next(info);
    }));
}

pub fn set_detailed(enabled: bool) {
    DETAILED.store(enabled, Ordering::Relaxed);
}

pub fn is_detailed() -> bool {
    DETAILED.load(Ordering::Relaxed)
}

/// Queues one line. Never blocks: when the writer falls behind, lines drop.
pub fn record(level: Level, tag: &str, message: &str) {
    if level < Level::Info && !is_detailed() {
        return;
    }
    let Some(sender) = SENDER.get() else {
        return;
    };
    let mut message = sanitize(message);
    if message.chars().count() > MAX_LINE_CHARS {
        let total = message.chars().count();
        message = message.chars().take(MAX_LINE_CHARS).collect::<String>();
        message.push_str(&format!("… ({total} chars)"));
    }
    let line = format!("{} {}/{}: {}\n", timestamp(), level.letter(), tag, message);
    let _ = sender.try_send(line);
}

/// Query strings are dropped and secret headers masked: tokens and cookies
/// must never reach a file the user shares.
pub fn sanitize(text: &str) -> String {
    static URL_QUERY: OnceLock<Regex> = OnceLock::new();
    static SECRET: OnceLock<Regex> = OnceLock::new();
    let url_query = URL_QUERY.get_or_init(|| {
        Regex::new(r#"(https?://[^\s?#"'<>]+)\?[^\s"'<>]*"#).expect("valid regex")
    });
    let secret = SECRET.get_or_init(|| {
        Regex::new(
            r#"(?i)\b(cookie|set-cookie|authorization|x-api-key|token|api[_-]?key|password)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}&]+)"#,
        )
        .expect("valid regex")
    });
    let text = url_query.replace_all(text, "$1?…");
    secret.replace_all(&text, "$1$2<hidden>").into_owned()
}

fn write_loop(rx: Receiver<String>) {
    while let Ok(first) = rx.recv() {
        let mut batch = first;
        while let Ok(next) = rx.try_recv() {
            batch.push_str(&next);
        }
        write(&batch);
    }
}

fn write(text: &str) {
    let Some(dir) = LOG_DIR.get() else {
        return;
    };
    let _guard = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let file = current(dir);
    let limit = if is_detailed() {
        DETAILED_FILE_LIMIT_BYTES
    } else {
        FILE_LIMIT_BYTES
    };
    let size = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    if size + text.len() as u64 > limit {
        let _ = fs::remove_file(previous(dir));
        let _ = fs::rename(&file, previous(dir));
    }
    if let Ok(mut out) = OpenOptions::new().create(true).append(true).open(&file) {
        let _ = out.write_all(text.as_bytes());
    }
}

/// Gives the writer thread a moment to drain, used before export and on panic.
pub fn flush() {
    std::thread::sleep(Duration::from_millis(150));
    let _guard = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
}

/// Older lines first, so the file reads top to bottom.
pub fn read_all() -> String {
    flush();
    let Some(dir) = LOG_DIR.get() else {
        return String::new();
    };
    let _guard = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    [previous(dir), current(dir)]
        .iter()
        .filter_map(|path| fs::read(path).ok())
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .collect()
}

pub fn clear() {
    let Some(dir) = LOG_DIR.get() else {
        return;
    };
    let _guard = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _ = fs::remove_file(previous(dir));
    let _ = fs::remove_file(current(dir));
}

/// UTC time as `MM-dd HH:mm:ss.SSS`.
fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let (_, month, day) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{:02}-{:02} {:02}:{:02}:{:02}.{:03}Z",
        month,
        day,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        now.subsec_millis()
    )
}

/// Days since 1970-01-01 to (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Routes `log` crate output (Tauri plugins such as libmpv) into the file.
struct PluginLogger;

impl log::Log for PluginLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info || is_detailed()
    }

    fn log(&self, rec: &log::Record) {
        if !self.enabled(rec.metadata()) {
            return;
        }
        let level = match rec.level() {
            log::Level::Error => Level::Error,
            log::Level::Warn => Level::Warn,
            log::Level::Info => Level::Info,
            _ => Level::Debug,
        };
        record(level, rec.target(), &rec.args().to_string());
    }

    fn flush(&self) {}
}

/// `eprintln!` plus a warning line in the log file.
#[macro_export]
macro_rules! vlog_warn {
    ($($arg:tt)*) => {{
        let message = format!($($arg)*);
        eprintln!("{}", message);
        $crate::app_log::record($crate::app_log::Level::Warn, "Rust", &message);
    }};
}

/// `println!` plus a debug line (kept only with detailed logging).
#[macro_export]
macro_rules! vlog_debug {
    ($($arg:tt)*) => {{
        let message = format!($($arg)*);
        println!("{}", message);
        $crate::app_log::record($crate::app_log::Level::Debug, "Rust", &message);
    }};
}

// Commands -----------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct JsLogEntry {
    level: String,
    message: String,
}

#[tauri::command]
pub fn log_write_batch(entries: Vec<JsLogEntry>) {
    for entry in entries {
        record(Level::from_name(&entry.level), "JS", &entry.message);
    }
}

#[tauri::command]
pub fn log_set_detailed(enabled: bool) {
    set_detailed(enabled);
}

#[tauri::command]
pub fn log_clear() {
    clear();
}

/// Writes the logs, with a system header, to `path` (chosen in a save dialog).
#[tauri::command]
pub async fn log_export(
    app: tauri::AppHandle,
    path: String,
    extra_header: Option<String>,
) -> Result<(), String> {
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let mut header = format!(
            "Vega Desktop {}\nOS {} {}\nDetailed logging {}\n",
            version,
            std::env::consts::OS,
            std::env::consts::ARCH,
            if is_detailed() { "on" } else { "off" },
        );
        if let Some(extra) = extra_header.filter(|text| !text.trim().is_empty()) {
            header.push_str(&sanitize(&extra));
            header.push('\n');
        }
        header.push_str("Times are UTC.\n----\n");
        let mut file = File::create(&path).map_err(|e| format!("Could not create {path}: {e}"))?;
        file.write_all(header.as_bytes())
            .and_then(|_| file.write_all(read_all().as_bytes()))
            .map_err(|e| format!("Could not write logs: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

import { invoke } from "@tauri-apps/api/core";
import { mainStorage } from "../storage";
import { frontendDiagnostics } from "./diagnostics";

/**
 * Keeps the newest frontend log lines in the same on-disk log as the Rust
 * side (src-tauri/src/app_log.rs), so a user can export them with a bug
 * report. Lines are batched and sent to Rust once a second.
 *
 * Always kept: console.info, console.warn, console.error, uncaught errors and
 * unhandled promise rejections.
 * Kept only while detailed logging is on: console.log and console.debug.
 */

const DETAILED_UNTIL_KEY = "logging.detailedUntil";
const DETAILED_DURATION_MS = 24 * 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH = 200;
const MAX_LINE_CHARS = 4000;

type Level = "debug" | "info" | "warn" | "error";
type Entry = { level: Level; message: string };

let pending: Entry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let detailedTimer: ReturnType<typeof setTimeout> | null = null;
let detailed = false;
let installed = false;

const formatArg = (arg: unknown): string => {
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
};

const flush = async (): Promise<void> => {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (pending.length === 0) return;
  const entries = pending;
  pending = [];
  try {
    await invoke("log_write_batch", { entries });
  } catch {}
};

const record = (level: Level, args: unknown[]) => {
  let message = args.map(formatArg).join(" ");
  if (message.length > MAX_LINE_CHARS) {
    message = `${message.slice(0, MAX_LINE_CHARS)}… (${message.length} chars)`;
  }
  pending.push({ level, message });
  if (pending.length >= MAX_BATCH) void flush();
  else if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
};

const readDetailedUntil = (): number =>
  Number(mainStorage.getNumber(DETAILED_UNTIL_KEY) ?? 0) || 0;

const applyDetailed = (enabled: boolean) => {
  detailed = enabled;
  invoke("log_set_detailed", { enabled }).catch(() => {});
  if (detailedTimer) clearTimeout(detailedTimer);
  detailedTimer = null;
  if (enabled) {
    // Turns itself off so nobody keeps it running by accident.
    detailedTimer = setTimeout(
      () => setDetailedLogging(false),
      Math.max(0, readDetailedUntil() - Date.now()),
    );
  }
};

export const isDetailedLoggingEnabled = (): boolean =>
  readDetailedUntil() > Date.now();

/** Detailed logging stays on for 24 hours, then turns itself off. */
export const setDetailedLogging = (enabled: boolean): void => {
  mainStorage.setNumber(
    DETAILED_UNTIL_KEY,
    enabled ? Date.now() + DETAILED_DURATION_MS : 0,
  );
  applyDetailed(enabled);
};

/** Asks where to save, then writes the logs there. False if cancelled. */
export const exportLogs = async (extraHeader?: string): Promise<boolean> => {
  await flush();
  const { save } = await import("@tauri-apps/plugin-dialog");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const path = await save({
    title: "Export Vega logs",
    defaultPath: `vega-logs-${stamp}.txt`,
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
  if (!path) return false;
  const header = [frontendDiagnostics(), extraHeader]
    .filter(Boolean)
    .join("\n");
  await invoke("log_export", { path, extraHeader: header });
  return true;
};

export const clearLogs = async (): Promise<void> => {
  pending = [];
  await invoke("log_clear");
};

/** Routes console output and uncaught errors into the log file. */
export const installVegaLog = (): void => {
  if (installed) return;
  installed = true;
  applyDetailed(isDetailedLoggingEnabled());

  const original = {
    log: console.log.bind(console),
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  const wrap =
    (level: Level, forward: (...args: unknown[]) => void, detailedOnly = false) =>
    (...args: unknown[]) => {
      forward(...args);
      if (!detailedOnly || detailed) record(level, args);
    };

  console.log = wrap("debug", original.log, true);
  console.debug = wrap("debug", original.debug, true);
  console.info = wrap("info", original.info);
  console.warn = wrap("warn", original.warn);
  console.error = wrap("error", original.error);

  // index.html logs errors until this point; take over from it.
  (window as { __vegaEarlyErrors?: () => void }).__vegaEarlyErrors?.();

  window.addEventListener("error", (event) => {
    record("error", [
      "Uncaught error:",
      event.error ?? `${event.message} (${event.filename}:${event.lineno})`,
    ]);
    void flush();
  });
  window.addEventListener("unhandledrejection", (event) => {
    record("error", ["Unhandled promise rejection:", event.reason]);
    void flush();
  });
  window.addEventListener("beforeunload", () => void flush());

  // Once per launch, so every exported log shows what this WebView supports.
  setTimeout(() => {
    try {
      console.info(`[Diagnostics]\n${frontendDiagnostics()}`);
    } catch {}
  }, 0);
};

import { invoke } from "@tauri-apps/api/core";
import { settingsStorage } from "../storage";

export type ProxyType = "none" | "byedpi" | "warp";

export interface ProxyStatus {
  proxy_type: ProxyType;
  is_running: boolean;
  port: number | null;
  error: string | null;
}

export const BYEDPI_PRESETS = [
  {
    id: "split-disorder",
    label: "Split & Disorder (Recommended)",
    args: "--split 1 --disorder 1 --auto=torst",
  },
  {
    id: "disorder-only",
    label: "Disorder only",
    args: "--disorder 1 --auto=torst",
  },
  {
    id: "split-only",
    label: "Split only",
    args: "--split 1",
  },
  {
    id: "fake-oob",
    label: "Fake packet (OOB)",
    args: "-s 1 -q 1 -Y",
  },
];

export async function startByeDpi(customArgs?: string): Promise<ProxyStatus> {
  const args = customArgs !== undefined ? customArgs : settingsStorage.getByeDpiCmdArgs();
  try {
    const status = await invoke<ProxyStatus>("start_byedpi", {
      customArgs: args,
    });
    settingsStorage.setByeDpiEnabled(true);
    settingsStorage.setWarpEnabled(false);
    return status;
  } catch (err) {
    console.error("[proxyService] Failed to start ByeDPI:", err);
    throw err;
  }
}

export async function stopByeDpi(): Promise<ProxyStatus> {
  try {
    const status = await invoke<ProxyStatus>("stop_byedpi");
    settingsStorage.setByeDpiEnabled(false);
    return status;
  } catch (err) {
    console.error("[proxyService] Failed to stop ByeDPI:", err);
    throw err;
  }
}

export async function getByeDpiStatus(): Promise<ProxyStatus> {
  try {
    return await invoke<ProxyStatus>("get_byedpi_status");
  } catch (err) {
    console.warn("[proxyService] Failed to get ByeDPI status:", err);
    return {
      proxy_type: "byedpi",
      is_running: false,
      port: null,
      error: String(err),
    };
  }
}

export async function startWarp(): Promise<ProxyStatus> {
  try {
    const status = await invoke<ProxyStatus>("start_warp");
    settingsStorage.setWarpEnabled(true);
    settingsStorage.setByeDpiEnabled(false);
    return status;
  } catch (err) {
    console.error("[proxyService] Failed to start WARP:", err);
    throw err;
  }
}

export async function stopWarp(): Promise<ProxyStatus> {
  try {
    const status = await invoke<ProxyStatus>("stop_warp");
    settingsStorage.setWarpEnabled(false);
    return status;
  } catch (err) {
    console.error("[proxyService] Failed to stop WARP:", err);
    throw err;
  }
}

export async function getWarpStatus(): Promise<ProxyStatus> {
  try {
    return await invoke<ProxyStatus>("get_warp_status");
  } catch (err) {
    console.warn("[proxyService] Failed to get WARP status:", err);
    return {
      proxy_type: "warp",
      is_running: false,
      port: null,
      error: String(err),
    };
  }
}

export async function getActiveProxyStatus(): Promise<ProxyStatus> {
  try {
    return await invoke<ProxyStatus>("get_active_proxy_status");
  } catch (err) {
    console.warn("[proxyService] Failed to get active proxy status:", err);
    return {
      proxy_type: "none",
      is_running: false,
      port: null,
      error: String(err),
    };
  }
}

export async function syncProxySettings(): Promise<void> {
  const warpEnabled = settingsStorage.isWarpEnabled();
  const byeDpiEnabled = settingsStorage.isByeDpiEnabled();

  try {
    if (warpEnabled) {
      console.log("[proxyService] Restoring WARP mode from settings...");
      await startWarp();
    } else if (byeDpiEnabled) {
      console.log("[proxyService] Restoring ByeDPI mode from settings...");
      await startByeDpi(settingsStorage.getByeDpiCmdArgs());
    } else {
      await stopWarp().catch(() => {});
      await stopByeDpi().catch(() => {});
    }
  } catch (err) {
    console.error("[proxyService] Proxy sync error during startup:", err);
  }
}

import { invoke } from "@tauri-apps/api/core";
import { documentDir, join } from "@tauri-apps/api/path";
import { settingsStorage } from "../storage";
import { parseSyncManifest, type VegaSyncManifest } from "./manifest";

export const getDesktopSyncRoot = async (): Promise<string> => {
  const configured = settingsStorage.getDownloadLocation();
  return configured === "vega"
    ? join(await documentDir(), "VegaDownloads")
    : configured;
};

export const readDesktopSyncManifests = async (
  baseDir: string,
): Promise<VegaSyncManifest[]> => {
  const contents = await invoke<string[]>("read_sync_manifests", { baseDir });
  return contents
    .map(parseSyncManifest)
    .filter((manifest): manifest is VegaSyncManifest => manifest !== null);
};

export const writeDesktopSyncManifest = async (
  baseDir: string,
  manifest: VegaSyncManifest,
): Promise<void> => {
  await invoke("write_sync_manifest", {
    baseDir,
    deviceId: manifest.deviceId,
    content: JSON.stringify(manifest),
  });
};

export const resolveDesktopSyncFile = async (
  baseDir: string,
  relativePath: string,
): Promise<string | null> => {
  const resolved = await invoke<string | null>("resolve_sync_media_path", {
    baseDir,
    relativePath,
  });
  if (resolved) {
    return resolved;
  }
  const segments = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) {
    return null;
  }
  if (segments.length > 1) {
    const legacyShowFile = await invoke<string | null>(
      "resolve_sync_media_path",
      {
        baseDir,
        relativePath: [segments[0], fileName].join("/"),
      },
    );
    if (legacyShowFile) {
      return legacyShowFile;
    }
  }
  return invoke<string | null>("resolve_sync_media_path", {
    baseDir,
    relativePath: fileName,
  });
};

export const getDesktopRelativePath = (
  baseDir: string,
  filePath: string,
): string | null => {
  const normalizedBase = baseDir.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedFile = filePath.replace(/\\/g, "/");
  const prefix = `${normalizedBase}/`;
  return normalizedFile.toLowerCase().startsWith(prefix.toLowerCase())
    ? normalizedFile.slice(prefix.length)
    : null;
};

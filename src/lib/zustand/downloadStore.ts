import { create } from "zustand";
import { persist } from "zustand/middleware";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { documentDir, join } from "@tauri-apps/api/path";
import { settingsStorage } from "../storage/SettingsStorage";

export interface DownloadItem {
  id: string;
  title: string; // Main title for movies, or full messy title
  showName?: string; // The clean Series/Movie name (e.g. House of the Dragon)
  episodeName?: string; // The original episode title
  seasonTitle?: string; // e.g. "Season 3"
  type: "movie" | "series";
  imdbId?: string;
  url: string;
  poster?: string;
  provider?: string;
  infoUrl?: string;
  sourceLink?: string;
  headers?: Record<string, string>;
  subtitles?: { url: string; language: string; format?: string }[];
  videoType?: string | null;
  isTorrent?: boolean;
  torrentInfoHash?: string;
  filePath: string;
  baseDir?: string;
  totalBytes: number;
  downloadedBytes: number;
  speed: number;
  status: "queued" | "downloading" | "paused" | "completed" | "error";
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
}

interface DownloadState {
  downloads: Record<string, DownloadItem>;
  addDownload: (
    item: Omit<
      DownloadItem,
      "status" | "downloadedBytes" | "totalBytes" | "speed" | "filePath"
    >,
  ) => Promise<void>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  startNow: (id: string) => Promise<void>;
  scheduleDownloads: () => void;
  cancelDownload: (id: string) => Promise<void>;
  removeDownload: (id: string) => Promise<void>;
  updateProgress: (
    id: string,
    downloaded: number,
    total: number,
    speed: number,
  ) => void;
  markCompleted: (id: string) => void;
  markError: (id: string) => void;
}

const getDownloadBaseDir = async () => {
  const configured = settingsStorage.getDownloadLocation();
  return configured === "vega"
    ? join(await documentDir(), "VegaDownloads")
    : configured;
};

const ACTIVE_DOWNLOAD_STATUSES = new Set(["downloading"]);

const shortPathHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const safePathSegment = (value: string, maxLength: number) => {
  const normalized = value
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "media";
  if (normalized.length <= maxLength) return normalized;
  const suffix = shortPathHash(value);
  return `${normalized.slice(0, maxLength - suffix.length - 1)}_${suffix}`;
};

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set, get) => {
      const startDownloadItem = async (id: string) => {
        const item = get().downloads[id];
        if (!item || item.status !== "queued") return;

        set((state) => ({
          downloads: {
            ...state.downloads,
            [id]: {
              ...state.downloads[id],
              status: "downloading",
              updatedAt: Date.now(),
            },
          },
        }));

        try {
          const baseDir = item.baseDir || (await getDownloadBaseDir());

          if (item.subtitles && item.subtitles.length > 0) {
            const { fetch } = await import("@tauri-apps/plugin-http");
            const baseName = item.filePath.substring(
              0,
              item.filePath.lastIndexOf("."),
            );
            let subIdx = 0;
            for (const sub of item.subtitles) {
              try {
                const ext =
                  sub.format || (sub.url.endsWith(".srt") ? "srt" : "vtt");
                const subPath = `${baseName}.${sub.language || "unk"}_${subIdx}.${ext}`;
                subIdx++;
                const response = await fetch(sub.url);
                if (response.ok) {
                  await invoke("save_subtitle", {
                    baseDir,
                    path: subPath,
                    content: await response.text(),
                  });
                }
              } catch (subErr) {
                console.error("Failed to download subtitle:", subErr);
              }
            }
          }

          if (item.isTorrent) {
            const apiPort = await invoke<number>("get_torrent_api_port");
            const { fetch } = await import("@tauri-apps/plugin-http");
            const res = await fetch(
              `http://127.0.0.1:${apiPort}/torrents?output_folder=${encodeURIComponent(item.filePath)}&overwrite=true`,
              { method: "POST", body: item.url },
            );
            if (!res.ok) throw new Error("Failed to add torrent to librqbit");
            const data = await res.json();
            if (data?.details?.info_hash) {
              set((state) => ({
                downloads: {
                  ...state.downloads,
                  [id]: {
                    ...state.downloads[id],
                    torrentInfoHash: data.details.info_hash,
                  },
                },
              }));
            }
          } else {
            await invoke("start_download", {
              id,
              url: item.url,
              baseDir,
              filePath: item.filePath,
              headers: item.headers || null,
              videoType:
                item.videoType || (item.url.includes(".m3u8") ? "m3u8" : null),
            });
          }
        } catch (e) {
          console.error("Failed to start download:", e);
          get().markError(id);
        }
      };

      const scheduleDownloads = () => {
        const downloads = Object.values(get().downloads);
        const activeCount = downloads.filter((item) =>
          ACTIVE_DOWNLOAD_STATUSES.has(item.status),
        ).length;
        const available = Math.max(
          settingsStorage.getDownloadConcurrency() - activeCount,
          0,
        );
        downloads
          .filter((item) => item.status === "queued")
          .sort(
            (left, right) =>
              (left.createdAt || 0) - (right.createdAt || 0) ||
              left.id.localeCompare(right.id),
          )
          .slice(0, available)
          .forEach((item) => {
            startDownloadItem(item.id).catch(() => undefined);
          });
      };

      return {
        downloads: {},

        addDownload: async (item) => {
          const id = item.id;
          const now = Date.now();

          // Determine save path
          const baseDir = await getDownloadBaseDir();

          const cleanName = item.showName || item.title;
          const safeTitle = safePathSegment(cleanName, 64).toLowerCase();

          // Always create a folder for the show/movie
          const safeDir = await join(baseDir, safeTitle);
          const safeSeason = item.seasonTitle
            ? safePathSegment(item.seasonTitle, 48).toLowerCase()
            : undefined;
          let filePath;
          const isTorrent = item.isTorrent || item.url.startsWith("magnet:");

          const groupDir = safeSeason
            ? await join(safeDir, safeSeason)
            : safeDir;

          if (isTorrent) {
            filePath = groupDir; // Each dropdown group gets its own torrent directory.
          } else if (item.episodeName) {
            const itemFile = safePathSegment(item.episodeName, 72);
            filePath = await join(groupDir, `${itemFile}.mp4`);
          } else {
            filePath = await join(groupDir, `${safeTitle}.mp4`);
          }

          const newItem: DownloadItem = {
            ...item,
            isTorrent,
            filePath,
            baseDir,
            status: "queued",
            downloadedBytes: 0,
            totalBytes: 0,
            speed: 0,
            createdAt: now,
            updatedAt: now,
          };

          set((state) => ({
            downloads: { ...state.downloads, [id]: newItem },
          }));

          scheduleDownloads();
        },

        scheduleDownloads,

        startNow: async (id) => {
          await startDownloadItem(id);
        },

        pauseDownload: async (id) => {
          const item = get().downloads[id];
          if (!item) return;

          set((state) => ({
            downloads: {
              ...state.downloads,
              [id]: { ...state.downloads[id], status: "paused", speed: 0 },
            },
          }));

          if (item.isTorrent && item.torrentInfoHash) {
            const apiPort = await invoke<number>("get_torrent_api_port");
            const { fetch } = await import("@tauri-apps/plugin-http");
            await fetch(
              `http://127.0.0.1:${apiPort}/torrents/${item.torrentInfoHash}/pause`,
              { method: "POST" },
            );
          } else if (!item.isTorrent) {
            await invoke("pause_download", { id });
          }
          scheduleDownloads();
        },

        resumeDownload: async (id) => {
          const item = get().downloads[id];
          if (!item) return;

          set((state) => ({
            downloads: {
              ...state.downloads,
              [id]: { ...state.downloads[id], status: "downloading" },
            },
          }));

          try {
            const baseDir = item.baseDir || (await getDownloadBaseDir());
            if (item.isTorrent && item.torrentInfoHash) {
              const apiPort = await invoke<number>("get_torrent_api_port");
              const { fetch } = await import("@tauri-apps/plugin-http");
              await fetch(
                `http://127.0.0.1:${apiPort}/torrents/${item.torrentInfoHash}/start`,
                { method: "POST" },
              );
            } else if (!item.isTorrent) {
              await invoke("start_download", {
                id,
                url: item.url,
                baseDir,
                filePath: item.filePath,
                headers: item.headers || null,
                videoType:
                  item.videoType ||
                  (item.url.includes(".m3u8") ? "m3u8" : null),
              });
            }
          } catch (e) {
            console.error("Failed to resume download:", e);
            get().markError(id);
          }
        },

        cancelDownload: async (id) => {
          const item = get().downloads[id];
          if (!item) return;

          const baseDir = item.baseDir || (await getDownloadBaseDir());

          try {
            if (item.isTorrent && item.torrentInfoHash) {
              const apiPort = await invoke<number>("get_torrent_api_port");
              const { fetch } = await import("@tauri-apps/plugin-http");
              await fetch(
                `http://127.0.0.1:${apiPort}/torrents/${item.torrentInfoHash}/delete`,
                { method: "POST" },
              );
            } else if (!item.isTorrent) {
              await invoke("cancel_download", {
                id,
                filePath: item.filePath,
                baseDir,
              });
            }
          } catch (e) {
            console.error("Failed to cancel download:", e);
          }

          set((state) => {
            const next = { ...state.downloads };
            delete next[id];
            return { downloads: next };
          });
          scheduleDownloads();
        },

        removeDownload: async (id) => {
          // If completed, maybe delete file too, but for now just remove from state
          set((state) => {
            const next = { ...state.downloads };
            delete next[id];
            return { downloads: next };
          });
        },

        updateProgress: (id, downloaded, total, speed) => {
          set((state) => {
            const item = state.downloads[id];
            if (!item) return state;
            return {
              downloads: {
                ...state.downloads,
                [id]: {
                  ...item,
                  downloadedBytes: downloaded,
                  totalBytes: total,
                  speed,
                  status: "downloading",
                },
              },
            };
          });
        },

        markCompleted: (id) => {
          set((state) => {
            const item = state.downloads[id];
            if (!item) return state;
            return {
              downloads: {
                ...state.downloads,
                [id]: {
                  ...item,
                  status: "completed",
                  speed: 0,
                  downloadedBytes: item.totalBytes,
                  completedAt: Date.now(),
                  updatedAt: Date.now(),
                },
              },
            };
          });
          scheduleDownloads();
        },

        markError: (id) => {
          set((state) => {
            const item = state.downloads[id];
            if (!item) return state;
            return {
              downloads: {
                ...state.downloads,
                [id]: { ...item, status: "error", speed: 0 },
              },
            };
          });
          scheduleDownloads();
        },
      };
    },
    {
      name: "vega-downloads-storage",
    },
  ),
);

let initialized = false;
export function initDownloadListeners() {
  if (initialized) return;
  initialized = true;

  listen("download-progress", (event: any) => {
    const { id, downloaded, total, speed } = event.payload;
    useDownloadStore.getState().updateProgress(id, downloaded, total, speed);
  });

  listen("download-complete", (event: any) => {
    // Check if the payload is an object (new format) or a string (old format fallback)
    const payload = event.payload;
    const id = typeof payload === "string" ? payload : payload.id;

    // If we have a final_path from the backend, update the state
    if (typeof payload === "object" && payload.final_path) {
      useDownloadStore.setState((state) => {
        const item = state.downloads[id];
        if (!item) return state;
        return {
          downloads: {
            ...state.downloads,
            [id]: { ...item, filePath: payload.final_path },
          },
        };
      });
    }

    useDownloadStore.getState().markCompleted(id);
  });

  useDownloadStore.setState((state) => ({
    downloads: Object.fromEntries(
      Object.entries(state.downloads).map(([id, item]) => [
        id,
        item.status === "downloading"
          ? { ...item, status: "queued" as const, speed: 0 }
          : item,
      ]),
    ),
  }));
  useDownloadStore.getState().scheduleDownloads();

  // Start polling loop for torrents
  startTorrentPolling();
}

async function startTorrentPolling() {
  const { fetch } = await import("@tauri-apps/plugin-http");

  // Re-add paused torrents because the scheduler handles queued items.
  const state = useDownloadStore.getState();
  const downloads = state.downloads;
  let apiPort = 0;

  try {
    apiPort = await invoke<number>("get_torrent_api_port");
  } catch (e) {
    console.error("Failed to get torrent port for downloads:", e);
    return;
  }

  for (const id in downloads) {
    const item = downloads[id];
    if (item.isTorrent && item.status === "paused") {
      try {
        const res = await fetch(
          `http://127.0.0.1:${apiPort}/torrents?output_folder=${encodeURIComponent(item.filePath)}&overwrite=true${item.status === "paused" ? "&paused=true" : ""}`,
          {
            method: "POST",
            body: item.url,
          },
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.details?.info_hash) {
            useDownloadStore.setState((s) => ({
              downloads: {
                ...s.downloads,
                [id]: {
                  ...s.downloads[id],
                  torrentInfoHash: data.details.info_hash,
                },
              },
            }));
          }
        }
      } catch (e) {
        console.error("Failed to re-add torrent on startup:", e);
      }
    }
  }

  // Polling loop
  setInterval(async () => {
    try {
      const currentState = useDownloadStore.getState();
      const activeTorrents = Object.values(currentState.downloads).filter(
        (d) =>
          d.isTorrent &&
          ["downloading"].includes(d.status) &&
          d.torrentInfoHash,
      );

      if (activeTorrents.length > 0) {
        const res = await fetch(
          `http://127.0.0.1:${apiPort}/torrents?with_stats=true`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data.torrents) {
            for (const active of activeTorrents) {
              const torrentDetails = data.torrents.find(
                (t: any) =>
                  t.info_hash?.toLowerCase() ===
                  active.torrentInfoHash?.toLowerCase(),
              );
              if (torrentDetails && torrentDetails.stats) {
                const stats = torrentDetails.stats;
                const downloaded = stats.progress_bytes || 0;
                const total = stats.total_bytes || 0;
                const speedMbps = stats.live?.download_speed?.mbps || 0;
                const speed = speedMbps * 1024 * 1024; // convert MB/s to B/s

                currentState.updateProgress(
                  active.id,
                  downloaded,
                  total,
                  speed,
                );

                // Stop seeding and complete if fully downloaded
                if (
                  total > 0 &&
                  downloaded >= total &&
                  active.status !== "completed"
                ) {
                  await fetch(
                    `http://127.0.0.1:${apiPort}/torrents/${active.torrentInfoHash}/pause`,
                    { method: "POST" },
                  );
                  currentState.markCompleted(active.id);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // Ignore polling errors
    }
  }, 2000);
}

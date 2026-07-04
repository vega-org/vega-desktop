import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { documentDir, join } from '@tauri-apps/api/path';
import { settingsStorage } from '../storage/SettingsStorage';

export interface DownloadItem {
  id: string;
  title: string;          // Main title for movies, or full messy title
  showName?: string;      // The clean Series/Movie name (e.g. House of the Dragon)
  episodeName?: string;   // The original episode title
  seasonTitle?: string;   // e.g. "Season 3"
  type: 'movie' | 'series';
  imdbId?: string;
  url: string;
  poster?: string;
  provider?: string;
  headers?: Record<string, string>;
  subtitles?: { url: string; language: string; format?: string }[];
  videoType?: string | null;
  isTorrent?: boolean;
  torrentInfoHash?: string;
  filePath: string;
  totalBytes: number;
  downloadedBytes: number;
  speed: number;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'error';
}

interface DownloadState {
  downloads: Record<string, DownloadItem>;
  addDownload: (item: Omit<DownloadItem, 'status' | 'downloadedBytes' | 'totalBytes' | 'speed' | 'filePath'>) => Promise<void>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  removeDownload: (id: string) => Promise<void>;
  updateProgress: (id: string, downloaded: number, total: number, speed: number) => void;
  markCompleted: (id: string) => void;
  markError: (id: string) => void;
}

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set, get) => {
      return {
        downloads: {},

        addDownload: async (item) => {
          const id = item.id;

          // Determine save path
          const customDir = settingsStorage.getDownloadLocation();
          const baseDir = customDir === 'vega' ? await join(await documentDir(), 'VegaDownloads') : customDir;

          const cleanName = item.showName || item.title;
          const safeTitle = cleanName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

          // Always create a folder for the show/movie
          const safeDir = await join(baseDir, safeTitle);
          let filePath;
          const isTorrent = item.isTorrent || item.url.startsWith('magnet:');
          
          if (isTorrent) {
            filePath = safeDir; // Torrents download into the directory directly
          } else if (item.type === 'series') {
            const epFile = (item.episodeName || item.id).replace(/[^a-z0-9]/gi, '_');
            filePath = await join(safeDir, `${epFile}.mp4`);
          } else {
            filePath = await join(safeDir, `${safeTitle}.mp4`);
          }

          const newItem: DownloadItem = {
            ...item,
            isTorrent,
            filePath,
            status: 'downloading',
            downloadedBytes: 0,
            totalBytes: 0,
            speed: 0,
          };

          set((state) => ({
            downloads: { ...state.downloads, [id]: newItem }
          }));

          try {
            // Download subtitles first
            if (item.subtitles && item.subtitles.length > 0) {
              const { fetch } = await import('@tauri-apps/plugin-http');

              const baseName = filePath.substring(0, filePath.lastIndexOf('.'));

              let subIdx = 0;
              for (const sub of item.subtitles) {
                try {
                  const ext = sub.format || (sub.url.endsWith('.srt') ? 'srt' : 'vtt');
                  const subPath = `${baseName}.${sub.language || 'unk'}_${subIdx}.${ext}`;
                  subIdx++;

                  const response = await fetch(sub.url);
                  if (response.ok) {
                    const text = await response.text();
                    await invoke('save_subtitle', { path: subPath, content: text });
                  }
                } catch (subErr) {
                  console.error('Failed to download subtitle:', subErr);
                }
              }
            }

            if (isTorrent) {
              const apiPort = await invoke<number>('get_torrent_api_port');
              const { fetch } = await import('@tauri-apps/plugin-http');
              const res = await fetch(`http://127.0.0.1:${apiPort}/torrents?output_folder=${encodeURIComponent(filePath)}&overwrite=true`, {
                method: 'POST',
                body: item.url,
              });
              if (!res.ok) throw new Error('Failed to add torrent to librqbit');
              const data = await res.json();
              if (data && data.details && data.details.info_hash) {
                set((state) => ({
                  downloads: {
                    ...state.downloads,
                    [id]: { ...state.downloads[id], torrentInfoHash: data.details.info_hash }
                  }
                }));
              }
            } else {
              await invoke('start_download', {
                id,
                url: item.url,
                filePath,
                headers: item.headers || null,
                videoType: item.videoType || (item.url.includes('.m3u8') ? 'm3u8' : null)
              });
            }

          } catch (e) {
            console.error('Failed to start download:', e);
            get().markError(id);
          }
        },

        pauseDownload: async (id) => {
          const item = get().downloads[id];
          if (!item) return;

          set((state) => ({
            downloads: {
              ...state.downloads,
              [id]: { ...state.downloads[id], status: 'paused', speed: 0 }
            }
          }));

          if (item.isTorrent && item.torrentInfoHash) {
            const apiPort = await invoke<number>('get_torrent_api_port');
            const { fetch } = await import('@tauri-apps/plugin-http');
            await fetch(`http://127.0.0.1:${apiPort}/torrents/${item.torrentInfoHash}/pause`, { method: 'POST' });
          } else if (!item.isTorrent) {
            await invoke('pause_download', { id });
          }
        },

        resumeDownload: async (id) => {
          const item = get().downloads[id];
          if (!item) return;

          set((state) => ({
            downloads: {
              ...state.downloads,
              [id]: { ...state.downloads[id], status: 'downloading' }
            }
          }));

          try {
            if (item.isTorrent && item.torrentInfoHash) {
              const apiPort = await invoke<number>('get_torrent_api_port');
              const { fetch } = await import('@tauri-apps/plugin-http');
              await fetch(`http://127.0.0.1:${apiPort}/torrents/${item.torrentInfoHash}/start`, { method: 'POST' });
            } else if (!item.isTorrent) {
              await invoke('start_download', {
                id,
                url: item.url,
                filePath: item.filePath,
                headers: item.headers || null,
                videoType: item.videoType || (item.url.includes('.m3u8') ? 'm3u8' : null)
              });
            }
          } catch (e) {
            console.error('Failed to resume download:', e);
            get().markError(id);
          }
        },

        cancelDownload: async (id) => {
          const item = get().downloads[id];
          if (!item) return;

          try {
            if (item.isTorrent && item.torrentInfoHash) {
              const apiPort = await invoke<number>('get_torrent_api_port');
              const { fetch } = await import('@tauri-apps/plugin-http');
              await fetch(`http://127.0.0.1:${apiPort}/torrents/${item.torrentInfoHash}/delete`, { method: 'POST' });
            } else if (!item.isTorrent) {
              await invoke('cancel_download', { id, filePath: item.filePath });
            }
          } catch (e) {
            console.error('Failed to cancel download:', e);
          }

          set((state) => {
            const next = { ...state.downloads };
            delete next[id];
            return { downloads: next };
          });
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
                [id]: { ...item, downloadedBytes: downloaded, totalBytes: total, speed, status: 'downloading' }
              }
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
                [id]: { ...item, status: 'completed', speed: 0, downloadedBytes: item.totalBytes }
              }
            };
          });
        },

        markError: (id) => {
          set((state) => {
            const item = state.downloads[id];
            if (!item) return state;
            return {
              downloads: {
                ...state.downloads,
                [id]: { ...item, status: 'error', speed: 0 }
              }
            };
          });
        }
      };
    },
    {
      name: 'vega-downloads-storage',
    }
  )
);

let initialized = false;
export function initDownloadListeners() {
  if (initialized) return;
  initialized = true;

  listen('download-progress', (event: any) => {
    const { id, downloaded, total, speed } = event.payload;
    useDownloadStore.getState().updateProgress(id, downloaded, total, speed);
  });

  listen('download-complete', (event: any) => {
    // Check if the payload is an object (new format) or a string (old format fallback)
    const payload = event.payload;
    const id = typeof payload === 'string' ? payload : payload.id;

    // If we have a final_path from the backend, update the state
    if (typeof payload === 'object' && payload.final_path) {
      useDownloadStore.setState((state) => {
        const item = state.downloads[id];
        if (!item) return state;
        return {
          downloads: {
            ...state.downloads,
            [id]: { ...item, filePath: payload.final_path }
          }
        };
      });
    }

    useDownloadStore.getState().markCompleted(id);
  });

  // Start polling loop for torrents
  startTorrentPolling();
}

async function startTorrentPolling() {
  const { fetch } = await import('@tauri-apps/plugin-http');
  
  // On startup, re-add any torrents that are in 'downloading' or 'queued' or 'paused' state
  // Because librqbit session does not persist across restarts since we delete its default dir!
  const state = useDownloadStore.getState();
  const downloads = state.downloads;
  let apiPort = 0;
  
  try {
    apiPort = await invoke<number>('get_torrent_api_port');
  } catch(e) {
    console.error("Failed to get torrent port for downloads:", e);
    return;
  }

  for (const id in downloads) {
    const item = downloads[id];
    if (item.isTorrent && ['downloading', 'queued', 'paused'].includes(item.status)) {
      try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/torrents?output_folder=${encodeURIComponent(item.filePath)}&overwrite=true${item.status === 'paused' ? '&paused=true' : ''}`, {
          method: 'POST',
          body: item.url,
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.details?.info_hash) {
            useDownloadStore.setState((s) => ({
              downloads: {
                ...s.downloads,
                [id]: { ...s.downloads[id], torrentInfoHash: data.details.info_hash }
              }
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
      const activeTorrents = Object.values(currentState.downloads).filter(d => d.isTorrent && ['downloading'].includes(d.status) && d.torrentInfoHash);
      
      if (activeTorrents.length > 0) {
        const res = await fetch(`http://127.0.0.1:${apiPort}/torrents?with_stats=true`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.torrents) {
            for (const active of activeTorrents) {
              const torrentDetails = data.torrents.find((t: any) => t.info_hash?.toLowerCase() === active.torrentInfoHash?.toLowerCase());
              if (torrentDetails && torrentDetails.stats) {
                const stats = torrentDetails.stats;
                const downloaded = stats.progress_bytes || 0;
                const total = stats.total_bytes || 0;
                const speedMbps = stats.live?.download_speed?.mbps || 0;
                const speed = speedMbps * 1024 * 1024; // convert MB/s to B/s
                
                currentState.updateProgress(active.id, downloaded, total, speed);
                
                // Stop seeding and complete if fully downloaded
                if (total > 0 && downloaded >= total && active.status !== 'completed') {
                  await fetch(`http://127.0.0.1:${apiPort}/torrents/${active.torrentInfoHash}/pause`, { method: 'POST' });
                  currentState.markCompleted(active.id);
                }
              }
            }
          }
        }
      }
    } catch(e) {
      // Ignore polling errors
    }
  }, 2000);
}

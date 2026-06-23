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
          
          // For series, save inside a folder
          let filePath;
          if (item.type === 'series') {
            const seasonFolder = item.seasonTitle ? `_${item.seasonTitle.replace(/[^a-z0-9]/gi, '_')}` : '';
            const epFile = (item.episodeName || item.id).replace(/[^a-z0-9]/gi, '_');
            const safeDir = await join(baseDir, safeTitle);
            filePath = await join(safeDir, `${epFile}.mp4`);
          } else {
            filePath = await join(baseDir, `${safeTitle}.mp4`);
          }

          const newItem: DownloadItem = {
            ...item,
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
            await invoke('start_download', {
              id,
              url: item.url,
              filePath
            });
          } catch (e) {
            console.error('Failed to start download:', e);
            get().markError(id);
          }
        },

        pauseDownload: async (id) => {
          set((state) => ({
            downloads: {
              ...state.downloads,
              [id]: { ...state.downloads[id], status: 'paused', speed: 0 }
            }
          }));
          await invoke('pause_download', { id });
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
            await invoke('start_download', {
              id,
              url: item.url,
              filePath: item.filePath
            });
          } catch (e) {
            console.error('Failed to resume download:', e);
            get().markError(id);
          }
        },

        cancelDownload: async (id) => {
          const item = get().downloads[id];
          if (!item) return;

          try {
            await invoke('cancel_download', { id, filePath: item.filePath });
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
    const id = event.payload;
    useDownloadStore.getState().markCompleted(id);
  });
}

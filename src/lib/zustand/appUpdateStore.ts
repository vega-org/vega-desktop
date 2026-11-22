import { create } from 'zustand';

export type AppUpdateStage =
  | 'idle'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'installed'
  | 'error';

export interface AppUpdateProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export interface AppUpdateInfo {
  currentVersion: string;
  targetVersion: string;
  releaseNotes: string;
  releaseUrl: string;
  canAutoDownload: boolean;
  restoreFocusKey?: string;
}

interface AppUpdateState {
  stage: AppUpdateStage;
  isChecking: boolean;
  currentVersion: string;
  targetVersion: string;
  releaseNotes: string;
  releaseUrl: string;
  canAutoDownload: boolean;
  progress: AppUpdateProgress;
  errorMessage: string | null;
  restoreFocusKey?: string;
  setChecking: (isChecking: boolean) => void;
  showAvailable: (info: AppUpdateInfo) => void;
  setDownloading: () => void;
  updateProgress: (progress: AppUpdateProgress) => void;
  setInstalling: () => void;
  setInstalled: () => void;
  setError: (errorMessage: string) => void;
  reset: () => void;
}

const initialProgress: AppUpdateProgress = {
  downloadedBytes: 0,
  totalBytes: null,
  percent: null,
};

const initialState = {
  stage: 'idle' as AppUpdateStage,
  isChecking: false,
  currentVersion: '',
  targetVersion: '',
  releaseNotes: '',
  releaseUrl: '',
  canAutoDownload: true,
  progress: initialProgress,
  errorMessage: null as string | null,
  restoreFocusKey: undefined as string | undefined,
};

export const useAppUpdateStore = create<AppUpdateState>((set) => ({
  ...initialState,
  setChecking: (isChecking) => set({ isChecking }),
  showAvailable: (info) =>
    set({
      stage: 'available',
      currentVersion: info.currentVersion,
      targetVersion: info.targetVersion,
      releaseNotes: info.releaseNotes,
      releaseUrl: info.releaseUrl,
      canAutoDownload: info.canAutoDownload,
      progress: initialProgress,
      errorMessage: null,
      restoreFocusKey: info.restoreFocusKey,
    }),
  setDownloading: () =>
    set({
      stage: 'downloading',
      progress: { downloadedBytes: 0, totalBytes: null, percent: 0 },
      errorMessage: null,
    }),
  updateProgress: (progress) => set({ progress }),
  setInstalling: () =>
    set((state) => ({
      stage: 'installing',
      progress: {
        downloadedBytes:
          state.progress.totalBytes ?? state.progress.downloadedBytes,
        totalBytes: state.progress.totalBytes,
        percent: 100,
      },
      errorMessage: null,
    })),
  setInstalled: () =>
    set({
      stage: 'installed',
      errorMessage: null,
    }),
  setError: (errorMessage) =>
    set({
      stage: 'error',
      errorMessage,
    }),
  reset: () =>
    set((state) => ({
      ...initialState,
      isChecking: state.isChecking,
    })),
}));

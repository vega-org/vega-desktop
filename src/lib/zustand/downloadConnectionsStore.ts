import { create } from "zustand";
import type { DownloadRange } from "../downloadSegmentMap";

export interface DownloadConnectionDetails {
  ranges: DownloadRange[];
  /** Connections receiving data now. */
  connections: number;
  /** Connections allowed now; below the setting after a rate limit. */
  connectionLimit: number;
}

interface DownloadConnectionsState {
  details: Record<string, DownloadConnectionDetails>;
  setDetails: (downloadId: string, details: DownloadConnectionDetails) => void;
  clearDetails: (downloadId: string) => void;
}

/**
 * Live connection data for active downloads. Kept out of the persisted
 * downloads store: it changes twice a second and means nothing after a restart.
 */
export const useDownloadConnectionsStore = create<DownloadConnectionsState>(
  (set) => ({
    details: {},
    setDetails: (downloadId, details) =>
      set((state) => ({ details: { ...state.details, [downloadId]: details } })),
    clearDetails: (downloadId) =>
      set((state) => {
        if (!(downloadId in state.details)) return state;
        const { [downloadId]: _removed, ...rest } = state.details;
        return { details: rest };
      }),
  }),
);

import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import type { DownloadItem } from "../zustand/downloadStore";
import { isVideoDownloadItem } from "../zustand/downloadStore";

let lastStatus: ProgressBarStatus | null = null;
let lastProgress: number | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDownloads: Record<string, DownloadItem> | null = null;

async function applyTaskbarProgress(downloads: Record<string, DownloadItem>) {
  try {
    const activeDownloads = Object.values(downloads).filter(
      (item) =>
        isVideoDownloadItem(item) &&
        (item.status === "downloading" ||
          item.status === "queued" ||
          item.status === "paused"),
    );

    if (activeDownloads.length === 0) {
      if (lastStatus !== ProgressBarStatus.None) {
        lastStatus = ProgressBarStatus.None;
        lastProgress = null;
        await getCurrentWindow().setProgressBar({
          status: ProgressBarStatus.None,
        });
      }
      return;
    }

    const isAnyDownloading = activeDownloads.some(
      (item) => item.status === "downloading",
    );
    const isAllPaused = activeDownloads.every(
      (item) => item.status === "paused",
    );

    let totalBytes = 0;
    let downloadedBytes = 0;
    let hasKnownTotal = false;

    for (const item of activeDownloads) {
      if (item.totalBytes > 0) {
        hasKnownTotal = true;
        totalBytes += item.totalBytes;
        downloadedBytes += Math.min(item.downloadedBytes, item.totalBytes);
      }
    }

    let nextStatus: ProgressBarStatus = ProgressBarStatus.Normal;
    let nextProgress: number | undefined = undefined;

    if (isAllPaused) {
      nextStatus = ProgressBarStatus.Paused;
    } else if (isAnyDownloading) {
      nextStatus = ProgressBarStatus.Normal;
    } else {
      nextStatus = ProgressBarStatus.Indeterminate;
    }

    if (hasKnownTotal && totalBytes > 0) {
      nextProgress = Math.min(
        100,
        Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)),
      );
    } else {
      nextStatus = ProgressBarStatus.Indeterminate;
      nextProgress = undefined;
    }

    // Only invoke Tauri IPC if something changed
    if (lastStatus !== nextStatus || lastProgress !== nextProgress) {
      lastStatus = nextStatus;
      lastProgress = nextProgress ?? null;
      await getCurrentWindow().setProgressBar({
        status: nextStatus,
        progress: nextProgress,
      });
    }
  } catch (error) {
    // Non-fatal, e.g. when running in non-Tauri browser dev environment
    console.debug("[TaskbarProgress] setProgressBar error:", error);
  }
}

export function updateTaskbarProgress(downloads: Record<string, DownloadItem>) {
  pendingDownloads = downloads;

  if (throttleTimer) return;

  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    if (pendingDownloads) {
      const data = pendingDownloads;
      pendingDownloads = null;
      applyTaskbarProgress(data);
    }
  }, 200);
}

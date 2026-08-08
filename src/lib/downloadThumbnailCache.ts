import { invoke } from "@tauri-apps/api/core";

const DOWNLOAD_THUMBNAIL_TIMESTAMP_SECONDS = 30;

const resolvedThumbnails = new Map<string, string | null>();
const pendingThumbnails = new Map<string, Promise<string | null>>();
let extractionQueue: Promise<void> = Promise.resolve();

const extractThumbnail = async (filePath: string) => {
  try {
    return await invoke<string>("generate_video_thumbnail", {
      source: filePath,
      timestamp: DOWNLOAD_THUMBNAIL_TIMESTAMP_SECONDS,
      headers: null,
    });
  } catch (error) {
    console.warn("Failed to generate downloaded video thumbnail", error);
    return null;
  }
};

/**
 * Generates the 30-second download thumbnail one at a time so opening a page
 * with many episodes cannot create a burst of MPV decoder instances. The
 * native command also persists each result in the app cache.
 */
export const getDownloadedVideoThumbnail = (filePath: string) => {
  const source = filePath.trim();
  if (!source) return Promise.resolve(null);

  if (resolvedThumbnails.has(source)) {
    return Promise.resolve(resolvedThumbnails.get(source) ?? null);
  }

  const pending = pendingThumbnails.get(source);
  if (pending) return pending;

  const request = new Promise<string | null>((resolve) => {
    extractionQueue = extractionQueue
      .catch(() => undefined)
      .then(async () => {
        const thumbnail = await extractThumbnail(source);
        resolvedThumbnails.set(source, thumbnail);
        pendingThumbnails.delete(source);
        resolve(thumbnail);
      });
  });

  pendingThumbnails.set(source, request);
  return request;
};

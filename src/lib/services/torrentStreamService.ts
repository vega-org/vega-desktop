import { invoke } from "@tauri-apps/api/core";

export function isTorrentUrl(url?: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith("magnet:") || trimmed.endsWith(".torrent");
}

export function extractInfoHash(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/urn:btih:([a-zA-Z0-9]+)/i);
  return match ? match[1].toLowerCase() : null;
}

const VIDEO_EXTENSIONS = [
  ".mkv",
  ".mp4",
  ".avi",
  ".webm",
  ".mov",
  ".m4v",
  ".ts",
  ".flv",
  ".wmv",
];

export interface ResolveTorrentOptions {
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
  timeoutMs?: number;
}

export interface TorrentStreamResult {
  streamUrl: string;
  infoHash: string;
}

const activeStreamTorrents = new Set<string>();

export function getInfoHashFromStreamUrl(streamUrl?: string | null): string | null {
  if (!streamUrl) return null;
  const match = streamUrl.match(/\/torrents\/([a-zA-Z0-9]+)\/stream\//i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Resolves a magnet URL or .torrent into a local HTTP streaming URL served by librqbit.
 */
export async function resolveTorrentStream(
  torrentUrl: string,
  options?: ResolveTorrentOptions,
): Promise<TorrentStreamResult> {
  if (!isTorrentUrl(torrentUrl)) {
    return { streamUrl: torrentUrl, infoHash: "" };
  }

  const timeoutMs = options?.timeoutMs || 45_000;
  const signal = options?.signal;
  options?.onProgress?.("Connecting to torrent network...");

  const apiPort = await invoke<number>("get_torrent_api_port");

  // 1. Add torrent to librqbit session
  const addRes = await fetch(`http://127.0.0.1:${apiPort}/torrents?overwrite=true`, {
    method: "POST",
    body: torrentUrl,
    signal,
  });

  if (!addRes.ok) {
    const errText = await addRes.text().catch(() => "");
    throw new Error(`Failed to add torrent to librqbit: ${errText || addRes.statusText}`);
  }

  const data = await addRes.json();
  const infoHash =
    data.details?.info_hash || extractInfoHash(torrentUrl) || (data.id !== undefined ? String(data.id) : null);

  if (!infoHash) {
    throw new Error("Failed to determine torrent info hash");
  }

  options?.onProgress?.("Waiting for torrent peers and metadata...");

  // 2. Poll until torrent is active (live or paused) and files metadata is populated
  const startTime = Date.now();
  let torrentDetails: any = data.details;

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) {
      throw new Error("Torrent stream resolution aborted");
    }

    try {
      const statsRes = await fetch(
        `http://127.0.0.1:${apiPort}/torrents/${infoHash}/stats/v1`,
        { signal },
      );

      if (statsRes.ok) {
        const stats = await statsRes.json();
        if (stats.state === "live" || stats.state === "paused") {
          // Verify we have file metadata
          if (!torrentDetails?.files || torrentDetails.files.length === 0) {
            const detailRes = await fetch(
              `http://127.0.0.1:${apiPort}/torrents/${infoHash}`,
              { signal },
            ).catch(() => null);

            if (detailRes?.ok) {
              const fullDetails = await detailRes.json();
              if (fullDetails?.files && fullDetails.files.length > 0) {
                torrentDetails = fullDetails;
                break;
              }
            }
          } else {
            break;
          }
        }
      }
    } catch (e: any) {
      if (signal?.aborted) throw e;
    }

    await new Promise((r) => setTimeout(r, 600));
  }

  // 3. Fallback check for files from /torrents/{infoHash}
  if (!torrentDetails?.files || torrentDetails.files.length === 0) {
    const detailRes = await fetch(
      `http://127.0.0.1:${apiPort}/torrents/${infoHash}`,
      { signal },
    ).catch(() => null);

    if (detailRes?.ok) {
      const fullDetails = await detailRes.json();
      if (fullDetails?.files && fullDetails.files.length > 0) {
        torrentDetails = fullDetails;
      }
    }
  }

  const files: Array<{ name: string; length?: number; [key: string]: any }> =
    torrentDetails?.files || [];

  if (files.length === 0) {
    throw new Error(
      "Torrent metadata timeout: could not retrieve file list from peers. Try another source.",
    );
  }

  // 4. Select the best media file (largest file with a video extension, or largest overall file)
  let bestIndex = 0;
  let bestFileName = files[0]?.name || "";
  let maxVideoSize = 0;

  files.forEach((f, idx) => {
    const lowerName = (f.name || "").toLowerCase();
    const isVideo = VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    const size = f.length || 0;

    if (isVideo && size > maxVideoSize) {
      maxVideoSize = size;
      bestIndex = idx;
      bestFileName = f.name;
    }
  });

  if (maxVideoSize === 0) {
    let maxOverallSize = 0;
    files.forEach((f, idx) => {
      const size = f.length || 0;
      if (size > maxOverallSize) {
        maxOverallSize = size;
        bestIndex = idx;
        bestFileName = f.name;
      }
    });
  }

  const rawName = bestFileName || "";
  const baseName = rawName.substring(
    Math.max(rawName.lastIndexOf("/"), rawName.lastIndexOf("\\")) + 1,
  );
  const nameSuffix = baseName ? `/${encodeURIComponent(baseName)}` : "";

  activeStreamTorrents.add(infoHash.toLowerCase());

  return {
    streamUrl: `http://127.0.0.1:${apiPort}/torrents/${infoHash}/stream/${bestIndex}${nameSuffix}`,
    infoHash,
  };
}

/**
 * Resolves a magnet URL or .torrent into a local HTTP streaming URL served by librqbit.
 */
export async function resolveTorrentStreamUrl(
  torrentUrl: string,
  options?: ResolveTorrentOptions,
): Promise<string> {
  if (!isTorrentUrl(torrentUrl)) {
    return torrentUrl;
  }
  const result = await resolveTorrentStream(torrentUrl, options);
  return result.streamUrl;
}

/**
 * Pauses or cleans up an active streaming torrent in librqbit.
 */
export async function pauseTorrentStream(infoHash: string): Promise<void> {
  try {
    const apiPort = await invoke<number>("get_torrent_api_port");
    await fetch(`http://127.0.0.1:${apiPort}/torrents/${infoHash}/pause`, {
      method: "POST",
    });
  } catch {}
}

/**
 * Deletes a torrent stream and removes downloaded files from disk via librqbit.
 * Verifies that the torrent is not a saved item in user's downloads before deleting.
 */
export async function deleteTorrentStream(infoHash: string): Promise<void> {
  if (!infoHash) return;
  const normalizedHash = infoHash.toLowerCase();
  activeStreamTorrents.delete(normalizedHash);

  try {
    const { useDownloadStore } = await import("../zustand/downloadStore");
    const downloads = useDownloadStore.getState().downloads || {};
    const isSavedDownload = Object.values(downloads).some(
      (item) =>
        item?.isTorrent &&
        item.torrentInfoHash?.toLowerCase() === normalizedHash,
    );

    if (isSavedDownload) {
      return;
    }

    const apiPort = await invoke<number>("get_torrent_api_port");
    await fetch(
      `http://127.0.0.1:${apiPort}/torrents/${encodeURIComponent(infoHash)}/delete`,
      {
        method: "POST",
        keepalive: true,
      },
    );
  } catch (e) {
    console.warn("[torrentStreamService] Failed to delete torrent stream:", e);
  }
}

/**
 * Cleans up all active streaming torrents and deletes downloaded cache files.
 */
export async function cleanupAllStreamTorrents(): Promise<void> {
  const hashes = Array.from(activeStreamTorrents);
  for (const hash of hashes) {
    await deleteTorrentStream(hash).catch(() => {});
  }
}

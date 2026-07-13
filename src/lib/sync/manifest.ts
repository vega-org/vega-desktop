export const VEGA_SYNC_SCHEMA_VERSION = 1;
export const VEGA_SYNC_DIRECTORY = ".vega-sync";

export type SyncRecordKind = "download" | "history";

export interface SyncedDownload {
  id: string;
  mediaKey?: string;
  title: string;
  showName?: string;
  episodeName?: string;
  seasonTitle?: string;
  type: "movie" | "series";
  imdbId?: string;
  poster?: string;
  background?: string;
  synopsis?: string;
  provider?: string;
  infoUrl?: string;
  sourceLink?: string;
  relativePath: string;
  totalBytes: number;
  completedAt: number;
  updatedAt: number;
}

export interface SyncedHistory {
  id: string;
  title: string;
  poster?: string;
  provider?: string;
  link: string;
  duration?: number;
  progress?: number;
  isSeries?: boolean;
  lastPlayed?: number;
  currentTime?: number;
  playbackRate?: number;
  episodeTitle?: string;
  cachedInfoData?: unknown;
  updatedAt: number;
}

export interface SyncTombstone {
  kind: SyncRecordKind;
  id: string;
  mediaKey?: string;
  deletedAt: number;
}

export interface VegaSyncManifest {
  schemaVersion: number;
  deviceId: string;
  revision: number;
  generatedAt: number;
  downloads: Record<string, SyncedDownload>;
  history: Record<string, SyncedHistory>;
  tombstones: Record<string, SyncTombstone>;
}

export interface MergedSyncState {
  downloads: Record<string, SyncedDownload>;
  history: Record<string, SyncedHistory>;
  tombstones: Record<string, SyncTombstone>;
}

export const getTombstoneKey = (kind: SyncRecordKind, id: string): string =>
  `${kind}:${id}`;

const normalizeKeyPart = (value?: string): string =>
  (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const getEpisodeKey = (item: SyncedDownload): string => {
  const episodeNumber =
    item.id.match(/_E(\d+)$/i)?.[1] ||
    item.episodeName?.match(/(?:episode|ep|e)[\s_.-]*(\d+)/i)?.[1];
  if (episodeNumber) {
    return `e${Number(episodeNumber)}`;
  }
  const directIndex = item.id.match(/_direct_(\d+)$/i)?.[1];
  return directIndex ? `d${Number(directIndex)}` : "e0";
};

const getDirectIndex = (item: SyncedDownload): string =>
  String(Number(item.id.match(/_direct_(\d+)$/i)?.[1] || "0"));

const getSeasonKey = (item: SyncedDownload): string => {
  const seasonNumber = item.seasonTitle?.match(/\d+/)?.[0];
  return seasonNumber
    ? String(Number(seasonNumber))
    : normalizeKeyPart(item.seasonTitle);
};

export const getDownloadMediaKey = (item: SyncedDownload): string => {
  const identity = item.imdbId
    ? normalizeKeyPart(item.imdbId)
    : normalizeKeyPart(item.showName || item.title);
  if (item.type === "series") {
    return `series:${identity}:${getSeasonKey(item)}:${getEpisodeKey(item)}`;
  }
  return `movie:${identity}:${getDirectIndex(item)}`;
};

const isManifest = (value: unknown): value is VegaSyncManifest => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const manifest = value as Partial<VegaSyncManifest>;
  return (
    manifest.schemaVersion === VEGA_SYNC_SCHEMA_VERSION &&
    typeof manifest.deviceId === "string" &&
    typeof manifest.revision === "number" &&
    Boolean(manifest.downloads) &&
    Boolean(manifest.history) &&
    Boolean(manifest.tombstones)
  );
};

export const parseSyncManifest = (content: string): VegaSyncManifest | null => {
  const parse = (value: string): VegaSyncManifest | null => {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isManifest(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const complete = parse(content);
  if (complete) {
    return complete;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return parse(content.slice(0, index + 1));
      }
    }
  }
  return null;
};

export const mergeSyncManifests = (
  manifests: VegaSyncManifest[],
): MergedSyncState => {
  const downloads: Record<string, SyncedDownload> = {};
  const history: Record<string, SyncedHistory> = {};
  const tombstones: Record<string, SyncTombstone> = {};

  for (const manifest of manifests) {
    for (const item of Object.values(manifest.downloads)) {
      const mediaKey = getDownloadMediaKey(item);
      const normalizedItem = { ...item, mediaKey };
      if (
        !downloads[mediaKey] ||
        normalizedItem.updatedAt > downloads[mediaKey].updatedAt
      ) {
        downloads[mediaKey] = normalizedItem;
      }
    }
    for (const [id, item] of Object.entries(manifest.history)) {
      if (!history[id] || item.updatedAt > history[id].updatedAt) {
        history[id] = item;
      }
    }
    for (const [key, tombstone] of Object.entries(manifest.tombstones)) {
      if (!tombstones[key] || tombstone.deletedAt > tombstones[key].deletedAt) {
        tombstones[key] = tombstone;
      }
    }
  }

  for (const tombstone of Object.values(tombstones)) {
    if (tombstone.kind === "download") {
      const itemKey = Object.keys(downloads).find(
        (key) =>
          downloads[key].id === tombstone.id ||
          key === tombstone.id ||
          key === tombstone.mediaKey,
      );
      const item = itemKey ? downloads[itemKey] : undefined;
      if (item && tombstone.deletedAt >= item.updatedAt) {
        delete downloads[itemKey!];
      }
    } else {
      const item = history[tombstone.id];
      if (item && tombstone.deletedAt >= item.updatedAt) {
        delete history[tombstone.id];
      }
    }
  }

  return { downloads, history, tombstones };
};

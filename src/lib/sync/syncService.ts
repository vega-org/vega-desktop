import { mainStorage, watchHistoryStorage } from "../storage";
import type { WatchHistoryItem } from "../storage/WatchHistoryStorage";
import { WatchHistoryKeys } from "../storage/WatchHistoryStorage";
import { useDownloadStore, type DownloadItem } from "../zustand/downloadStore";
import useWatchHistoryStore from "../zustand/watchHistrory";
import {
  getTombstoneKey,
  getDownloadMediaKey,
  mergeSyncManifests,
  VEGA_SYNC_SCHEMA_VERSION,
  type SyncTombstone,
  type SyncedDownload,
  type SyncedHistory,
  type VegaSyncManifest,
} from "./manifest";
import {
  getDesktopRelativePath,
  getDesktopSyncRoot,
  readDesktopSyncManifests,
  resolveDesktopSyncFile,
  writeDesktopSyncManifest,
} from "./desktopManifestStorage";

const DEVICE_ID_KEY = "vega-sync-device-id";
const REVISION_KEY = "vega-sync-revision";
const TOMBSTONES_KEY = "vega-sync-tombstones";
const PUBLISH_DELAY_MS = 3000;

let initialized = false;
let applyingRemoteState = false;
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let syncRequest: Promise<void> | undefined;
let previousDownloads: Record<string, DownloadItem> = {};
let previousHistory: WatchHistoryItem[] = [];

const getDeviceId = () => {
  const existing = mainStorage.getString(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }
  const created = crypto.randomUUID();
  mainStorage.setString(DEVICE_ID_KEY, created);
  return created;
};

const getTombstones = (): Record<string, SyncTombstone> =>
  mainStorage.getObject<Record<string, SyncTombstone>>(TOMBSTONES_KEY) || {};

const saveTombstones = (tombstones: Record<string, SyncTombstone>) =>
  mainStorage.setObject(TOMBSTONES_KEY, tombstones);

const addTombstone = (
  kind: SyncTombstone["kind"],
  id: string,
  mediaKey?: string,
) => {
  const tombstones = getTombstones();
  tombstones[getTombstoneKey(kind, id)] = {
    kind,
    id,
    mediaKey,
    deletedAt: Date.now(),
  };
  saveTombstones(tombstones);
};

const toSyncedHistory = (item: WatchHistoryItem): SyncedHistory => ({
  ...item,
  id: item.id || item.link,
  updatedAt: item.timestamp || 0,
});

const toDownloadIdentity = (item: DownloadItem): SyncedDownload => ({
  id: item.id,
  title: item.title,
  showName: item.showName,
  episodeName: item.episodeName,
  seasonTitle: item.seasonTitle,
  type: item.type,
  imdbId: item.imdbId,
  provider: item.provider,
  infoUrl: item.infoUrl,
  sourceLink: item.sourceLink,
  relativePath: "",
  totalBytes: item.totalBytes,
  completedAt: item.completedAt || item.updatedAt || 0,
  updatedAt: item.updatedAt || 0,
});

const buildManifest = async (): Promise<VegaSyncManifest> => {
  const baseDir = await getDesktopSyncRoot();
  const revision = (mainStorage.getNumber(REVISION_KEY) || 0) + 1;
  mainStorage.setNumber(REVISION_KEY, revision);
  const downloads = Object.fromEntries(
    Object.values(useDownloadStore.getState().downloads)
      .filter((item) => item.status === "completed")
      .flatMap((item) => {
        const relativePath = getDesktopRelativePath(baseDir, item.filePath);
        if (!relativePath) {
          return [];
        }
        const updatedAt = item.updatedAt || item.completedAt || 0;
        const synced: SyncedDownload = {
          id: item.id,
          title: item.title,
          showName: item.showName,
          episodeName: item.episodeName,
          seasonTitle: item.seasonTitle,
          type: item.type,
          imdbId: item.imdbId,
          poster: item.poster,
          provider: item.provider,
          infoUrl: item.infoUrl,
          sourceLink: item.sourceLink,
          relativePath,
          totalBytes: item.totalBytes,
          completedAt: item.completedAt || updatedAt,
          updatedAt,
        };
        synced.mediaKey = getDownloadMediaKey(synced);
        return [[item.id, synced]];
      }),
  );
  const history = Object.fromEntries(
    watchHistoryStorage
      .getWatchHistory()
      .map((item) => [item.id || item.link, toSyncedHistory(item)]),
  );
  return {
    schemaVersion: VEGA_SYNC_SCHEMA_VERSION,
    deviceId: getDeviceId(),
    revision,
    generatedAt: Date.now(),
    downloads,
    history,
    tombstones: getTombstones(),
  };
};

export const publishSyncManifest = async (): Promise<void> => {
  const baseDir = await getDesktopSyncRoot();
  await writeDesktopSyncManifest(baseDir, await buildManifest());
};

const schedulePublish = () => {
  if (applyingRemoteState || publishTimer) {
    return;
  }
  publishTimer = setTimeout(() => {
    publishTimer = undefined;
    publishSyncManifest().catch((error) =>
      console.warn("[VegaSync] Failed to publish manifest:", error),
    );
  }, PUBLISH_DELAY_MS);
};

const applyRemoteDownloads = async (
  baseDir: string,
  downloads: Record<string, SyncedDownload>,
) => {
  for (const item of Object.values(downloads)) {
    const currentDownloads = useDownloadStore.getState().downloads;
    const equivalentEntries = Object.entries(currentDownloads).filter(
      ([, candidate]) => {
        if (candidate.status !== "completed") {
          return false;
        }
        return (
          getDownloadMediaKey(toDownloadIdentity(candidate)) === item.mediaKey
        );
      },
    );
    const existing = equivalentEntries
      .map(([, candidate]) => candidate)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (
      existing?.status === "completed" &&
      (existing.updatedAt || 0) >= item.updatedAt
    ) {
      if (equivalentEntries.length > 1) {
        useDownloadStore.setState((state) => ({
          downloads: Object.fromEntries(
            Object.entries(state.downloads).filter(
              ([id]) =>
                id === existing.id ||
                !equivalentEntries.some(([duplicateId]) => duplicateId === id),
            ),
          ),
        }));
      }
      continue;
    }
    const filePath = await resolveDesktopSyncFile(baseDir, item.relativePath);
    if (!filePath) {
      continue;
    }
    useDownloadStore.setState((state) => ({
      downloads: {
        ...state.downloads,
        [item.id]: {
          id: item.id,
          title: item.title,
          showName: item.showName,
          episodeName: item.episodeName,
          seasonTitle: item.seasonTitle,
          type: item.type,
          imdbId: item.imdbId,
          poster: item.poster,
          provider: item.provider,
          infoUrl: item.infoUrl,
          sourceLink: item.sourceLink,
          url: "",
          filePath,
          totalBytes: item.totalBytes,
          downloadedBytes: item.totalBytes,
          speed: 0,
          status: "completed",
          createdAt: item.completedAt,
          completedAt: item.completedAt,
          updatedAt: item.updatedAt,
        },
      },
    }));
    if (equivalentEntries.some(([id]) => id !== item.id)) {
      useDownloadStore.setState((state) => ({
        downloads: Object.fromEntries(
          Object.entries(state.downloads).filter(
            ([id]) =>
              id === item.id ||
              !equivalentEntries.some(([duplicateId]) => duplicateId === id),
          ),
        ),
      }));
    }
  }
};

const applyRemoteHistory = (history: Record<string, SyncedHistory>) => {
  const items: WatchHistoryItem[] = Object.values(history)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 100)
    .map(({ updatedAt, ...item }) => ({ ...item, timestamp: updatedAt }));
  mainStorage.setArray(WatchHistoryKeys.WATCH_HISTORY, items);
  useWatchHistoryStore.setState({
    history: items.map((item) => ({
      ...item,
      lastPlayed: item.timestamp,
      currentTime: item.progress || 0,
    })),
  });
};

const applyTombstones = (tombstones: Record<string, SyncTombstone>) => {
  const downloads = { ...useDownloadStore.getState().downloads };
  let history = watchHistoryStorage.getWatchHistory();
  for (const tombstone of Object.values(tombstones)) {
    if (tombstone.kind === "download") {
      for (const [id, item] of Object.entries(downloads)) {
        const matches =
          id === tombstone.id ||
          (tombstone.mediaKey &&
            item.status === "completed" &&
            getDownloadMediaKey(toDownloadIdentity(item)) ===
              tombstone.mediaKey);
        if (matches && tombstone.deletedAt >= (item.updatedAt || 0)) {
          delete downloads[id];
        }
      }
    } else {
      history = history.filter(
        (item) =>
          (item.id || item.link) !== tombstone.id ||
          (item.timestamp || 0) > tombstone.deletedAt,
      );
    }
  }
  useDownloadStore.setState({ downloads });
  mainStorage.setArray(WatchHistoryKeys.WATCH_HISTORY, history);
};

const runSharedFolderSync = async (): Promise<void> => {
  const baseDir = await getDesktopSyncRoot();
  const manifests = await readDesktopSyncManifests(baseDir);
  const localManifest = await buildManifest();
  const merged = mergeSyncManifests([...manifests, localManifest]);
  applyingRemoteState = true;
  try {
    saveTombstones(merged.tombstones);
    applyTombstones(merged.tombstones);
    await applyRemoteDownloads(baseDir, merged.downloads);
    applyRemoteHistory(merged.history);
  } finally {
    applyingRemoteState = false;
  }
  previousDownloads = useDownloadStore.getState().downloads;
  previousHistory = watchHistoryStorage.getWatchHistory();
  await publishSyncManifest();
};

export const syncFromSharedFolder = (): Promise<void> => {
  if (!syncRequest) {
    syncRequest = runSharedFolderSync().finally(() => {
      syncRequest = undefined;
    });
  }
  return syncRequest;
};

export const initializeSyncService = async (): Promise<void> => {
  if (!initialized) {
    initialized = true;
    previousDownloads = useDownloadStore.getState().downloads;
    previousHistory = watchHistoryStorage.getWatchHistory();
    useDownloadStore.subscribe((state) => {
      if (applyingRemoteState) {
        previousDownloads = state.downloads;
        return;
      }
      for (const [id, item] of Object.entries(previousDownloads)) {
        if (item.status === "completed" && !state.downloads[id]) {
          addTombstone(
            "download",
            id,
            getDownloadMediaKey(toDownloadIdentity(item)),
          );
        }
      }
      previousDownloads = state.downloads;
      schedulePublish();
    });
    useWatchHistoryStore.subscribe((state) => {
      if (applyingRemoteState) {
        previousHistory = watchHistoryStorage.getWatchHistory();
        return;
      }
      const currentIds = new Set(
        state.history.map((item) => item.id || item.link),
      );
      for (const item of previousHistory) {
        const id = item.id || item.link;
        if (!currentIds.has(id)) {
          addTombstone("history", id);
        }
      }
      previousHistory = watchHistoryStorage.getWatchHistory();
      schedulePublish();
    });
  }
  await syncFromSharedFolder();
};

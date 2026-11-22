import {cacheStorage, mainStorage} from './storage/StorageService';
import {SettingsKeys, settingsStorage} from './storage/SettingsStorage';
import {ProvidersKeys} from './storage/ProvidersStorage';
import {
  ExtensionKeys,
  type ProviderExtension,
  type ProviderModule,
  type ProviderSource,
} from './storage/extensionStorage';
import {
  WatchHistoryKeys,
  watchHistoryStorage,
  type WatchHistoryItem,
} from './storage/WatchHistoryStorage';
import useContentStore from './zustand/contentStore';
import useThemeStore from './zustand/themeStore';
import useWatchHistoryStore from './zustand/watchHistrory';
import {
  createLibraryBackup,
  restoreLibraryBackup,
  validateLibraryBackup,
  type LibraryBackup,
} from './libraryBackup';

// Bump only when older apps would misread the file. New optional sections
// (history, progress) keep version 2 so older apps still import the rest.
export const BACKUP_VERSION = 2;

export type BackupSelection = {
  settings: boolean;
  library: boolean;
  providers: boolean;
  history: boolean;
  progress: boolean;
};

export const ALL_BACKUP_SECTIONS: BackupSelection = {
  settings: true,
  library: true,
  providers: true,
  history: true,
  progress: true,
};

export interface BackupHistoryItem {
  id: string;
  title: string;
  episodeTitle?: string;
  seasonTitle?: string;
  episode: {
    id?: string;
    title: string;
    link: string;
    sourceLink?: string;
    description?: string;
    image?: string;
  };
  type: string;
  poster?: string;
  background?: string;
  providerValue: string;
  infoUrl: string;
  position: number;
  duration: number;
  updatedAt: number;
}

export interface WatchProgress {
  position: number;
  duration: number;
}

type SettingType = 'bool' | 'string' | 'number' | 'array';

// Download location and launcher icon are left out because they point to
// device state (a folder permission and an activity alias) that a restore
// cannot bring back. Buffer sizes (forwardBufferMB, backBufferMB) are also
// left out because their safe limits depend on the device's physical RAM and heap.
const BACKUP_SETTINGS: Record<string, SettingType> = {
  [SettingsKeys.PRIMARY_COLOR]: 'string',
  [SettingsKeys.IS_CUSTOM_THEME]: 'bool',
  [SettingsKeys.SHOW_TAB_BAR_LABELS]: 'bool',
  [SettingsKeys.SHOW_CONTINUE_WATCHING]: 'bool',
  [SettingsKeys.CUSTOM_COLOR]: 'string',
  [SettingsKeys.UI_SCALE]: 'number',
  [SettingsKeys.VERIFICATION_WINDOWS]: 'string',
  [SettingsKeys.AUTO_UPDATE_PROVIDERS]: 'bool',
  [SettingsKeys.HAPTIC_FEEDBACK]: 'bool',
  [SettingsKeys.NOTIFICATIONS_ENABLED]: 'bool',
  [SettingsKeys.AUTO_CHECK_UPDATE]: 'bool',
  [SettingsKeys.AUTO_DOWNLOAD]: 'bool',
  [SettingsKeys.SHOW_MEDIA_CONTROLS]: 'bool',
  [SettingsKeys.SHOW_HAMBURGER_MENU]: 'bool',
  [SettingsKeys.HIDE_SEEK_BUTTONS]: 'bool',
  [SettingsKeys.SHOW_PLAYER_EPISODE_SIDEBAR]: 'bool',
  [SettingsKeys.ENABLE_2X_GESTURE]: 'bool',
  [SettingsKeys.ENABLE_SWIPE_GESTURE]: 'bool',
  [SettingsKeys.EXCLUDED_QUALITIES]: 'array',
  [SettingsKeys.DOWNLOAD_CONCURRENCY]: 'number',
  [SettingsKeys.DOWNLOAD_CONNECTIONS]: 'number',
  [SettingsKeys.SUBTITLE_FONT_SIZE]: 'number',
  [SettingsKeys.SUBTITLE_BOTTOM_PADDING]: 'number',
  [SettingsKeys.SUBTITLE_TEXT_COLOR]: 'string',
  [SettingsKeys.SUBTITLE_FONT_FAMILY]: 'string',
  [SettingsKeys.LIST_VIEW_TYPE]: 'string',
  [SettingsKeys.TELEMETRY_OPT_IN]: 'bool',
  [SettingsKeys.TMDB_API_KEY]: 'string',
  [SettingsKeys.TMDB_API_KEY_REVISION]: 'number',
  [SettingsKeys.WARP_ENABLED]: 'bool',
  [SettingsKeys.BYEDPI_ENABLED]: 'bool',
  [SettingsKeys.BYEDPI_CMD_ARGS]: 'string',
  // Saved by the Preferences screen without a SettingsKeys entry.
  disableDrawer: 'bool',
  showRecentlyWatched: 'bool',
  useExternalPlayer: 'bool',
  alwaysExternalDownloader: 'bool',
  [SettingsKeys.TV_MODE_ENABLED]: 'bool',
  [SettingsKeys.INFO_PAGE_DYNAMIC_THEME]: 'bool',
  [SettingsKeys.SUBTITLE_FONT_WEIGHT]: 'number',
  [SettingsKeys.SUBTITLE_OUTLINE_SIZE]: 'number',
  [SettingsKeys.SUBTITLE_OUTLINE_COLOR]: 'string',
  [SettingsKeys.SUBTITLE_SHADOW_COLOR]: 'string',
  [SettingsKeys.SUBTITLE_SHADOW_SIZE]: 'number',
  [SettingsKeys.SUBTITLE_SHADOW_STYLE]: 'string',
  [SettingsKeys.HARDWARE_ACCELERATION]: 'bool',
  [SettingsKeys.DEVTOOLS_SHORTCUTS_ENABLED]: 'bool',
  [SettingsKeys.EXTERNAL_PLAYER_ENABLED]: 'bool',
  [SettingsKeys.VLC_ENABLED]: 'bool',
  [SettingsKeys.PLAYER_ZOOM]: 'number',
  [SettingsKeys.PLAYER_ENGINE]: 'string',
};
type SettingValue = boolean | string | number | string[];

export interface VegaBackup {
  library?: LibraryBackup;
  app: 'vega';
  version: number;
  createdAt: string;
  settings?: Record<string, SettingValue>;
  providers?: {
    installed: ProviderExtension[];
    sources: ProviderSource[];
    modules: ProviderModule[];
    disabled?: string[];
    selected?: ProviderExtension;
  };
  history?: BackupHistoryItem[];
  progress?: Record<string, WatchProgress>;
}

const readSetting = (key: string, type: SettingType) => {
  switch (type) {
    case 'bool':
      return mainStorage.getBool(key);
    case 'string':
      return mainStorage.getString(key);
    case 'number':
      return mainStorage.getNumber(key);
    case 'array':
      return mainStorage.getArray<string>(key);
  }
};

const isValidSetting = (value: unknown, type: SettingType) => {
  switch (type) {
    case 'bool':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'array':
      return isStringArray(value);
  }
};

const writeSetting = (key: string, type: SettingType, value: SettingValue) => {
  switch (type) {
    case 'bool':
      mainStorage.setBool(key, value as boolean);
      break;
    case 'string':
      mainStorage.setString(key, value as string);
      break;
    case 'number':
      mainStorage.setNumber(key, value as number);
      break;
    case 'array':
      mainStorage.setArray(key, value as string[]);
      break;
  }
};

const isProvider = (value: unknown): value is ProviderExtension => {
  const provider = value as ProviderExtension;
  return (
    typeof provider?.value === 'string' &&
    typeof provider.display_name === 'string' &&
    typeof provider.type === 'string' &&
    typeof provider.version === 'string' &&
    typeof provider.source?.author === 'string' &&
    typeof provider.source?.url === 'string'
  );
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const isProviderModule = (value: unknown): value is ProviderModule =>
  typeof (value as ProviderModule)?.value === 'string' &&
  !!(value as ProviderModule).modules &&
  typeof (value as ProviderModule).modules === 'object';

const isProviderSource = (value: unknown): value is ProviderSource =>
  typeof (value as ProviderSource)?.author === 'string' &&
  typeof (value as ProviderSource)?.url === 'string';

const parseWatchProgress = (raw?: string): WatchProgress | null => {
  if (!raw || !raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof parsed.position === 'number' &&
      typeof parsed.duration === 'number' &&
      Number.isFinite(parsed.position) &&
      Number.isFinite(parsed.duration) &&
      Object.keys(parsed).length === 2
    ) {
      return {position: parsed.position, duration: parsed.duration};
    }
  } catch {
    return null;
  }
  return null;
};

const isDeviceLocalKey = (key: string): boolean =>
  key.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(key) || key.startsWith('/');

const progressRatio = (progress: WatchProgress): number =>
  progress.duration > 0 ? progress.position / progress.duration : 0;

const toBackupHistoryItem = (item: WatchHistoryItem): BackupHistoryItem => {
  const position =
    typeof item.progress === 'number' && Number.isFinite(item.progress)
      ? item.progress
      : typeof item.currentTime === 'number' && Number.isFinite(item.currentTime)
        ? item.currentTime
        : 0;
  const duration =
    typeof item.duration === 'number' && Number.isFinite(item.duration)
      ? item.duration
      : 0;
  const rawUpdatedAt = item.timestamp ?? item.lastPlayed ?? 0;
  const updatedAt = Number.isFinite(rawUpdatedAt) ? rawUpdatedAt : 0;
  const episodeLink =
    (typeof item.episode?.sourceLink === 'string' && item.episode.sourceLink) ||
    (typeof item.episode?.link === 'string' && item.episode.link) ||
    item.id ||
    item.link;
  const episodeTitleVal =
    (typeof item.episode?.title === 'string' && item.episode.title) ||
    (typeof item.episodeTitle === 'string' && item.episodeTitle) ||
    item.title;
  const episode: BackupHistoryItem['episode'] = {
    title: episodeTitleVal,
    link: episodeLink,
  };
  if (typeof item.episode?.id === 'string') episode.id = item.episode.id;
  if (typeof item.episode?.sourceLink === 'string') {
    episode.sourceLink = item.episode.sourceLink;
  }
  if (typeof item.episode?.description === 'string') {
    episode.description = item.episode.description;
  }
  if (typeof item.episode?.image === 'string') {
    episode.image = item.episode.image;
  }

  return {
    id: item.link,
    title: typeof item.title === 'string' ? item.title : '',
    ...(typeof item.episodeTitle === 'string' ? {episodeTitle: item.episodeTitle} : {}),
    ...(typeof item.seasonTitle === 'string' ? {seasonTitle: item.seasonTitle} : {}),
    episode,
    type: typeof item.type === 'string' ? item.type : item.isSeries ? 'series' : 'movie',
    ...(typeof item.poster === 'string' ? {poster: item.poster} : {}),
    ...(typeof item.background === 'string' ? {background: item.background} : {}),
    providerValue: typeof item.provider === 'string' ? item.provider : '',
    infoUrl: item.link,
    position,
    duration,
    updatedAt,
  };
};

const createHistoryBackup = (): BackupHistoryItem[] => {
  const latestByLink = new Map<string, BackupHistoryItem>();
  for (const item of watchHistoryStorage.getWatchHistory()) {
    if (item.provider === 'local' || item.duration === 1 || !item.link) {
      continue;
    }
    const candidate = toBackupHistoryItem(item);
    const existing = latestByLink.get(candidate.infoUrl);
    if (!existing || candidate.updatedAt > existing.updatedAt) {
      latestByLink.set(candidate.infoUrl, candidate);
    }
  }
  return Array.from(latestByLink.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 30);
};

const createProgressBackup = (): Record<string, WatchProgress> => {
  const result: Record<string, WatchProgress> = {};
  for (const key of cacheStorage.getKeys()) {
    if (!key || isDeviceLocalKey(key)) continue;
    const progress = parseWatchProgress(cacheStorage.getString(key));
    if (progress) {
      result[key] = progress;
    }
  }
  for (const item of watchHistoryStorage.getWatchHistory()) {
    if (item.provider === 'local' || !item.episode) continue;
    const duration = item.duration ?? 0;
    const position = item.progress ?? item.currentTime ?? 0;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) {
      continue;
    }
    const key = item.episode.sourceLink || item.episode.link;
    if (!key || isDeviceLocalKey(key)) continue;
    const candidate: WatchProgress = {position, duration};
    const existing = result[key];
    if (!existing || progressRatio(candidate) > progressRatio(existing)) {
      result[key] = candidate;
    }
  }
  return result;
};

export const validateHistoryBackup = (value: unknown): void => {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error('This backup contains an invalid watch history');
  }
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as BackupHistoryItem).id !== 'string' ||
      typeof (item as BackupHistoryItem).title !== 'string' ||
      ((item as BackupHistoryItem).episodeTitle !== undefined &&
        typeof (item as BackupHistoryItem).episodeTitle !== 'string') ||
      ((item as BackupHistoryItem).seasonTitle !== undefined &&
        typeof (item as BackupHistoryItem).seasonTitle !== 'string') ||
      !(item as BackupHistoryItem).episode ||
      typeof (item as BackupHistoryItem).episode !== 'object' ||
      typeof (item as BackupHistoryItem).episode.title !== 'string' ||
      typeof (item as BackupHistoryItem).episode.link !== 'string' ||
      typeof (item as BackupHistoryItem).type !== 'string' ||
      ((item as BackupHistoryItem).poster !== undefined &&
        typeof (item as BackupHistoryItem).poster !== 'string') ||
      ((item as BackupHistoryItem).background !== undefined &&
        typeof (item as BackupHistoryItem).background !== 'string') ||
      typeof (item as BackupHistoryItem).providerValue !== 'string' ||
      typeof (item as BackupHistoryItem).infoUrl !== 'string' ||
      typeof (item as BackupHistoryItem).position !== 'number' ||
      !Number.isFinite((item as BackupHistoryItem).position) ||
      typeof (item as BackupHistoryItem).duration !== 'number' ||
      !Number.isFinite((item as BackupHistoryItem).duration) ||
      typeof (item as BackupHistoryItem).updatedAt !== 'number' ||
      !Number.isFinite((item as BackupHistoryItem).updatedAt)
    ) {
      throw new Error('This backup contains an invalid watch history');
    }
  }
};

export const validateProgressBackup = (value: unknown): void => {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('This backup contains an invalid watch progress');
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof key !== 'string' ||
      key.length === 0 ||
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof (entry as WatchProgress).position !== 'number' ||
      !Number.isFinite((entry as WatchProgress).position) ||
      typeof (entry as WatchProgress).duration !== 'number' ||
      !Number.isFinite((entry as WatchProgress).duration)
    ) {
      throw new Error('This backup contains an invalid watch progress');
    }
  }
};

const mergeCacheProgress = (key: string, imported: WatchProgress): void => {
  if (!key) return;
  const local = parseWatchProgress(cacheStorage.getString(key));
  if (!local || progressRatio(imported) > progressRatio(local)) {
    cacheStorage.setString(
      key,
      JSON.stringify({position: imported.position, duration: imported.duration}),
    );
  }
};

export const restoreHistoryBackup = (history?: BackupHistoryItem[]): void => {
  if (history === undefined) return;
  validateHistoryBackup(history);
  const itemMap = new Map<string, WatchHistoryItem>();
  for (const existing of watchHistoryStorage.getWatchHistory()) {
    itemMap.set(existing.id, existing);
  }
  for (const item of history) {
    const convertedId =
      item.episode.sourceLink || item.episode.id || item.episode.link || item.id;
    const converted: WatchHistoryItem = {
      id: convertedId,
      title: item.title,
      link: item.infoUrl,
      provider: item.providerValue,
      timestamp: item.updatedAt,
      lastPlayed: item.updatedAt,
      progress: item.position,
      currentTime: item.position,
      duration: item.duration,
      type: item.type,
      isSeries: item.type === 'series',
      episode: {
        ...item.episode,
        id: item.episode.id || item.episode.link,
      },
      ...(item.episodeTitle !== undefined ? {episodeTitle: item.episodeTitle} : {}),
      ...(item.seasonTitle !== undefined ? {seasonTitle: item.seasonTitle} : {}),
      ...(item.poster !== undefined ? {poster: item.poster} : {}),
      ...(item.background !== undefined ? {background: item.background} : {}),
    };
    const existing = itemMap.get(convertedId) ?? itemMap.get(item.id);
    const existingTime = existing ? existing.timestamp ?? existing.lastPlayed ?? 0 : -1;
    if (!existing || item.updatedAt > existingTime) {
      if (item.id !== convertedId) {
        itemMap.delete(item.id);
      }
      itemMap.set(convertedId, converted);
    }
    if (item.duration > 0) {
      const progress: WatchProgress = {position: item.position, duration: item.duration};
      const keys = [item.episode.id, item.episode.sourceLink, item.episode.link].filter(
        (key): key is string => Boolean(key),
      );
      for (const key of keys) {
        mergeCacheProgress(key, progress);
      }
    }
  }
  const merged = Array.from(itemMap.values())
    .sort((a, b) => (b.timestamp ?? b.lastPlayed ?? 0) - (a.timestamp ?? a.lastPlayed ?? 0))
    .slice(0, 100);
  mainStorage.setArray(WatchHistoryKeys.WATCH_HISTORY, merged);
  useWatchHistoryStore.setState({
    history: merged.map(item => ({
      ...item,
      lastPlayed: item.timestamp,
      currentTime: item.progress || 0,
    })),
  });
};

export const restoreProgressBackup = (progress?: Record<string, WatchProgress>): void => {
  if (progress === undefined) return;
  validateProgressBackup(progress);
  for (const [key, imported] of Object.entries(progress)) {
    mergeCacheProgress(key, imported);
  }
};

export function createBackup(): VegaBackup & {settings: Record<string, SettingValue>};
export function createBackup(selection: BackupSelection): VegaBackup;
export function createBackup(selection: BackupSelection = ALL_BACKUP_SECTIONS): VegaBackup {
  if (
    !selection.settings &&
    !selection.library &&
    !selection.providers &&
    !selection.history &&
    !selection.progress
  ) {
    throw new Error('Select at least one section to back up');
  }
  const settings: Record<string, SettingValue> = {};
  if (selection.settings) {
    for (const [key, type] of Object.entries(BACKUP_SETTINGS)) {
      // Only saved values are included so defaults stay defaults after restore.
      if (!mainStorage.contains(key)) {
        continue;
      }
      const value = readSetting(key, type);
      if (value !== undefined) {
        settings[key] = value;
      }
    }
    if (typeof settings[SettingsKeys.INFO_PAGE_DYNAMIC_THEME] === 'boolean') {
      settings.dynamicInfoAccent = settings[SettingsKeys.INFO_PAGE_DYNAMIC_THEME];
    }
  }

  const selected = selection.providers ? useContentStore.getState().provider : undefined;

  return {
    ...(selection.library ? {library: createLibraryBackup()} : {}),
    app: 'vega',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    ...(selection.settings ? {settings} : {}),
    ...(selection.providers
      ? {
          providers: {
            installed:
              mainStorage.getArray<ProviderExtension>(
                ExtensionKeys.INSTALLED_PROVIDERS,
              ) || [],
            sources:
              mainStorage.getArray<ProviderSource>(ExtensionKeys.PROVIDER_SOURCES) ||
              [],
            modules:
              mainStorage.getArray<ProviderModule>(ExtensionKeys.PROVIDER_MODULES) ||
              [],
            disabled: mainStorage.getArray<string>(ProvidersKeys.DISABLED_PROVIDERS),
            selected: selected?.value ? selected : undefined,
          },
        }
      : {}),
    ...(selection.history ? {history: createHistoryBackup()} : {}),
    ...(selection.progress ? {progress: createProgressBackup()} : {}),
  };
}

export const parseBackup = (text: string): VegaBackup => {
  let data: VegaBackup;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Vega backup');
  }
  if (data?.app !== 'vega' || typeof data.version !== 'number') {
    throw new Error('This file is not a Vega backup');
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of Vega');
  }
  const {settings, providers, library, history, progress} = data;
  const settingsValid =
    settings !== undefined &&
    settings !== null &&
    typeof settings === 'object' &&
    !Array.isArray(settings);
  const providersValid =
    providers !== undefined &&
    providers !== null &&
    typeof providers === 'object' &&
    !Array.isArray(providers) &&
    Array.isArray(providers.installed) &&
    Array.isArray(providers.sources) &&
    Array.isArray(providers.modules);
  if (
    (settings !== undefined && !settingsValid) ||
    (providers !== undefined && !providersValid) ||
    (data.version < 2 && (!settingsValid || !providersValid)) ||
    (settings === undefined &&
      providers === undefined &&
      library === undefined &&
      history === undefined &&
      progress === undefined)
  ) {
    throw new Error('This backup file is incomplete');
  }
  validateLibraryBackup(data.library);
  validateHistoryBackup(data.history);
  validateProgressBackup(data.progress);
  return data;
};

export const restoreBackup = (backup: VegaBackup): void => {
  validateLibraryBackup(backup.library);
  validateHistoryBackup(backup.history);
  validateProgressBackup(backup.progress);
  restoreLibraryBackup(backup.library);
  restoreHistoryBackup(backup.history);
  restoreProgressBackup(backup.progress);

  if (backup.settings !== undefined) {
    const settings = backup.settings || {};
    for (const [key, type] of Object.entries(BACKUP_SETTINGS)) {
      const value = settings[key];
      if (isValidSetting(value, type)) {
        writeSetting(key, type, value);
      }
    }
    if (
      !isValidSetting(settings[SettingsKeys.INFO_PAGE_DYNAMIC_THEME], 'bool') &&
      typeof settings.dynamicInfoAccent === 'boolean'
    ) {
      writeSetting(SettingsKeys.INFO_PAGE_DYNAMIC_THEME, 'bool', settings.dynamicInfoAccent);
    }

    // The theme store keeps its own persisted copy, so update it too. Do this
    // before selecting the provider so it cannot overwrite it (see #526).
    useThemeStore.setState({
      primary: settingsStorage.getPrimaryColor(),
      isCustom: settingsStorage.isCustomTheme(),
    });
  }

  if (backup.providers !== undefined) {
    const {installed, sources, modules, disabled, selected} = backup.providers;
    if (Array.isArray(installed)) {
      const providers = installed.filter(isProvider);
      mainStorage.setArray(ExtensionKeys.INSTALLED_PROVIDERS, providers);
      useContentStore.getState().setInstalledProviders(providers);
    }
    if (Array.isArray(sources)) {
      mainStorage.setArray(
        ExtensionKeys.PROVIDER_SOURCES,
        sources.filter(isProviderSource),
      );
    }
    if (Array.isArray(modules)) {
      mainStorage.setArray(
        ExtensionKeys.PROVIDER_MODULES,
        modules.filter(isProviderModule),
      );
    }
    if (isStringArray(disabled)) {
      mainStorage.setArray(ProvidersKeys.DISABLED_PROVIDERS, disabled);
    }
    if (isProvider(selected)) {
      useContentStore.getState().setProvider(selected);
    }
  }
};

export const describeBackupSections = (backup: VegaBackup): string =>
  [
    backup.settings !== undefined && 'settings',
    backup.library !== undefined && 'library',
    backup.providers !== undefined && 'providers',
    backup.history !== undefined && 'watch history',
    backup.progress !== undefined && 'watch progress',
  ]
    .filter(Boolean)
    .join(', ');

export const exportBackup = async (
  selection: BackupSelection = ALL_BACKUP_SECTIONS,
): Promise<boolean> => {
  const {save} = await import('@tauri-apps/plugin-dialog');
  const {writeTextFile} = await import('@tauri-apps/plugin-fs');
  const path = await save({
    defaultPath: `vega-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{name: 'Vega backup', extensions: ['json']}],
  });
  if (!path) return false;
  await writeTextFile(path, JSON.stringify(createBackup(selection), null, 2));
  return true;
};

export const pickBackup = async (): Promise<VegaBackup | undefined> => {
  const {open} = await import('@tauri-apps/plugin-dialog');
  const {readTextFile} = await import('@tauri-apps/plugin-fs');
  const path = await open({
    multiple: false,
    filters: [{name: 'Vega backup', extensions: ['json']}],
  });
  if (!path) return undefined;
  return parseBackup(await readTextFile(path));
};

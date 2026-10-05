// Export StorageService
export {StorageService, mainStorage, cacheStorage} from './StorageService';

// Export SettingsStorage
export {
  SettingsStorage,
  settingsStorage,
  MAX_DOWNLOAD_CONNECTIONS,
  MIN_DOWNLOAD_CONNECTIONS,
} from './SettingsStorage';
export type {SettingsKeys} from './SettingsStorage';

// Export WatchHistoryStorage
export {WatchHistoryStorage, watchHistoryStorage} from './WatchHistoryStorage';
export type {
  WatchHistoryKeys,
  WatchHistoryItem,
  SeriesEpisode,
} from './WatchHistoryStorage';

// Export WatchListStorage
export {
  WatchListStorage,
  watchListStorage,
  DEFAULT_COLLECTION,
  DEFAULT_COLLECTION_ID,
  getItemCollectionIds,
} from './WatchListStorage';
export type {
  WatchListKeys,
  WatchListItem,
  LibraryCollection,
} from './WatchListStorage';

// Export CacheStorage
export {CacheStorage, cacheStorageService} from './CacheStorage';

// Export ProvidersStorage
export {ProvidersStorage, providersStorage} from './ProvidersStorage';
export type {ProvidersKeys} from './ProvidersStorage';

// Export ExtensionStorage
export {ExtensionStorage, extensionStorage} from './extensionStorage';
export type {
  ExtensionKeys,
  ProviderExtension,
  ProviderModule,
} from './extensionStorage';

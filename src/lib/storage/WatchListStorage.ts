import { mainStorage } from "./StorageService";

/**
 * Storage keys for the library (saved titles and their categories)
 */
export enum WatchListKeys {
  WATCH_LIST = "watchlist",
  COLLECTIONS = "library-collections",
}

/**
 * Built-in category. It always exists, cannot be deleted, and holds titles
 * saved without picking a category (and titles saved by older app versions).
 */
export const DEFAULT_COLLECTION_ID = "watchlist";

/**
 * Interface for watchlist item
 */
export interface WatchListItem {
  title: string;
  poster: string;
  link: string;
  provider: string;
  updatedAt?: number;
  /** Category ids. Missing or empty means the default category. */
  collections?: string[];
}

/**
 * User-made library category. `icon` is a key from LIBRARY_ICONS or an emoji.
 */
export interface LibraryCollection {
  id: string;
  name: string;
  icon: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_COLLECTION: LibraryCollection = {
  id: DEFAULT_COLLECTION_ID,
  name: "Watchlist",
  icon: "bookmark",
  createdAt: 0,
  updatedAt: 0,
};

/**
 * Categories of an item, limited to categories that exist. Falls back to the
 * default category, so an item never disappears when a category is deleted.
 */
export const getItemCollectionIds = (
  item: WatchListItem,
  existingIds: ReadonlySet<string>,
): string[] => {
  const ids = (item.collections || []).filter(
    id => id === DEFAULT_COLLECTION_ID || existingIds.has(id),
  );
  return ids.length > 0 ? ids : [DEFAULT_COLLECTION_ID];
};

export const createCollectionId = (): string =>
  `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Watchlist storage manager
 */
export class WatchListStorage {
  /**
   * Get all watchlist items
   */
  getWatchList(): WatchListItem[] {
    return mainStorage.getArray<WatchListItem>(WatchListKeys.WATCH_LIST) || [];
  }

  /**
   * Add an item to the watchlist
   */
  addToWatchList(item: WatchListItem): WatchListItem[] {
    const watchList = this.getWatchList();

    // Filter out any existing item with the same link
    const newWatchList = watchList.filter(i => i.link !== item.link);

    // Add the new item to the end
    newWatchList.push({
      ...item,
      collections: item.collections?.length
        ? item.collections
        : [DEFAULT_COLLECTION_ID],
      updatedAt: Date.now(),
    });

    // Save the updated watchlist
    mainStorage.setArray(WatchListKeys.WATCH_LIST, newWatchList);

    return newWatchList;
  }

  /**
   * Set the categories of an item. Adds the item when it is not saved yet and
   * removes it when no category is left.
   */
  setItemCollections(item: WatchListItem, ids: string[]): WatchListItem[] {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return this.removeFromWatchList(item.link);
    }
    const watchList = this.getWatchList();
    const index = watchList.findIndex(i => i.link === item.link);
    if (index === -1) {
      return this.addToWatchList({ ...item, collections: unique });
    }
    watchList[index] = {
      ...watchList[index],
      collections: unique,
      updatedAt: Date.now(),
    };
    mainStorage.setArray(WatchListKeys.WATCH_LIST, watchList);
    return watchList;
  }

  /**
   * Remove an item from the watchlist
   */
  removeFromWatchList(link: string): WatchListItem[] {
    const watchList = this.getWatchList();
    const newWatchList = watchList.filter(item => item.link !== link);

    mainStorage.setArray(WatchListKeys.WATCH_LIST, newWatchList);

    return newWatchList;
  }

  /**
   * Clear all items from the watchlist
   */
  clearWatchList(): WatchListItem[] {
    const emptyList: WatchListItem[] = [];
    mainStorage.setArray(WatchListKeys.WATCH_LIST, emptyList);
    return emptyList;
  }

  /**
   * Check if an item exists in the watchlist
   */
  isInWatchList(link: string): boolean {
    const watchList = this.getWatchList();
    return watchList.some(item => item.link === link);
  }

  /**
   * User-made categories, oldest first. The default category is not stored.
   */
  getCollections(): LibraryCollection[] {
    const collections =
      mainStorage.getArray<LibraryCollection>(WatchListKeys.COLLECTIONS) || [];
    return collections
      .filter(
        c => Boolean(c?.id && c.name) && c.id !== DEFAULT_COLLECTION_ID,
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  saveCollections(collections: LibraryCollection[]): LibraryCollection[] {
    const sorted = [...collections].sort((a, b) => a.createdAt - b.createdAt);
    mainStorage.setArray(WatchListKeys.COLLECTIONS, sorted);
    return sorted;
  }

  /**
   * Delete a category. Its titles stay in the library: titles in no other
   * category move to the default category.
   */
  deleteCollection(id: string): {
    collections: LibraryCollection[];
    watchList: WatchListItem[];
  } {
    const collections = this.saveCollections(
      this.getCollections().filter(c => c.id !== id),
    );
    const now = Date.now();
    let changed = false;
    const watchList = this.getWatchList().map(item => {
      if (!item.collections?.includes(id)) {
        return item;
      }
      changed = true;
      const rest = item.collections.filter(c => c !== id);
      return {
        ...item,
        collections: rest.length > 0 ? rest : [DEFAULT_COLLECTION_ID],
        updatedAt: now,
      };
    });
    if (changed) {
      mainStorage.setArray(WatchListKeys.WATCH_LIST, watchList);
    }
    return {collections, watchList};
  }
}

// Export a singleton instance
export const watchListStorage = new WatchListStorage();

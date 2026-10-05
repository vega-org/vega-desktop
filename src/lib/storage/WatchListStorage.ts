import { mainStorage } from "./StorageService";

/**
 * Storage keys for the library (saved titles and their categories)
 */
export enum WatchListKeys {
  WATCH_LIST = "watchlist",
  COLLECTIONS = "library-collections",
  /** Set once the Watchlist category was added to the stored categories. */
  DEFAULT_COLLECTION_ADDED = "library-default-collection-added",
}

/**
 * Category every library starts with. It is stored like any other category,
 * so the user can rename or delete it. While it exists, it holds titles saved
 * by older app versions and titles whose categories were all deleted.
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
 * Categories of an item, limited to categories that exist. Falls back to
 * Watchlist while it exists; otherwise the item is in no category and shows
 * only under All.
 */
export const getItemCollectionIds = (
  item: WatchListItem,
  existingIds: ReadonlySet<string>,
): string[] => {
  const ids = (item.collections || []).filter(id => existingIds.has(id));
  if (ids.length > 0) {
    return ids;
  }
  return existingIds.has(DEFAULT_COLLECTION_ID) ? [DEFAULT_COLLECTION_ID] : [];
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

    // Add the new item to the end. Without categories it goes to Watchlist,
    // or to the only category when Watchlist was deleted.
    const collections = this.getCollections();
    const fallback = collections.some(c => c.id === DEFAULT_COLLECTION_ID)
      ? [DEFAULT_COLLECTION_ID]
      : collections.length === 1
        ? [collections[0].id]
        : [];
    newWatchList.push({
      ...item,
      collections: item.collections?.length ? item.collections : fallback,
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
   * Library categories, oldest first, Watchlist included while it exists.
   */
  getCollections(): LibraryCollection[] {
    const collections = (
      mainStorage.getArray<LibraryCollection>(WatchListKeys.COLLECTIONS) || []
    ).filter(c => Boolean(c?.id && c.name));
    // Older versions kept Watchlist out of storage. Add it once; after that
    // a missing Watchlist means the user deleted it. Its createdAt and
    // updatedAt of 0 let a synced edit or delete from another device win.
    if (!mainStorage.getBool(WatchListKeys.DEFAULT_COLLECTION_ADDED, false)) {
      mainStorage.setBool(WatchListKeys.DEFAULT_COLLECTION_ADDED, true);
      if (!collections.some(c => c.id === DEFAULT_COLLECTION_ID)) {
        return this.saveCollections([DEFAULT_COLLECTION, ...collections]);
      }
    }
    return collections.sort((a, b) => a.createdAt - b.createdAt);
  }

  saveCollections(collections: LibraryCollection[]): LibraryCollection[] {
    const sorted = [...collections].sort((a, b) => a.createdAt - b.createdAt);
    mainStorage.setArray(WatchListKeys.COLLECTIONS, sorted);
    return sorted;
  }

  /**
   * Delete a category. Its titles stay in the library: titles in no other
   * category move to Watchlist, or to no category when Watchlist is gone.
   */
  deleteCollection(id: string): {
    collections: LibraryCollection[];
    watchList: WatchListItem[];
  } {
    const collections = this.saveCollections(
      this.getCollections().filter(c => c.id !== id),
    );
    const fallback = collections.some(c => c.id === DEFAULT_COLLECTION_ID)
      ? [DEFAULT_COLLECTION_ID]
      : [];
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
        collections: rest.length > 0 ? rest : fallback,
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

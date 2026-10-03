import {create} from 'zustand';
import {watchListStorage, WatchListItem} from '../storage';
import {
  createCollectionId,
  DEFAULT_COLLECTION_ID,
  getItemCollectionIds,
  type LibraryCollection,
} from '../storage/WatchListStorage';

// Reuse the WatchListItem interface from our storage
export type WatchList = WatchListItem;

export type CollectionDraft = Pick<LibraryCollection, 'name' | 'icon' | 'color'>;

interface WatchListStore {
  watchList: WatchList[];
  /** User-made library categories (the default category is not included). */
  collections: LibraryCollection[];
  removeItem: (link: string) => void;
  addItem: (item: WatchList) => void;
  /** Replace the categories of a title. No categories removes the title. */
  setItemCollections: (item: WatchList, ids: string[]) => void;
  /** Take titles out of one category; titles left in none are removed. */
  removeFromCollection: (links: string[], collectionId: string) => void;
  createCollection: (draft: CollectionDraft) => LibraryCollection;
  updateCollection: (id: string, draft: CollectionDraft) => void;
  deleteCollection: (id: string) => void;
}

const useWatchListStore = create<WatchListStore>()((set, get) => ({
  // Initialize from storage
  watchList: watchListStorage.getWatchList(),
  collections: watchListStorage.getCollections(),

  // Remove item using storage service
  removeItem: link => {
    const newWatchList = watchListStorage.removeFromWatchList(link);
    set({watchList: newWatchList});
  },

  // Add item using storage service
  addItem: item => {
    const newWatchList = watchListStorage.addToWatchList(item);
    set({watchList: newWatchList});
  },

  setItemCollections: (item, ids) => {
    set({watchList: watchListStorage.setItemCollections(item, ids)});
  },

  removeFromCollection: (links, collectionId) => {
    const existingIds = new Set(get().collections.map(c => c.id));
    const targets = new Set(links);
    let watchList = watchListStorage.getWatchList();
    for (const item of watchList) {
      if (!targets.has(item.link)) {
        continue;
      }
      const ids = getItemCollectionIds(item, existingIds).filter(
        id => id !== collectionId,
      );
      watchList = watchListStorage.setItemCollections(item, ids);
    }
    set({watchList});
  },

  createCollection: draft => {
    const now = Date.now();
    const collection: LibraryCollection = {
      id: createCollectionId(),
      name: draft.name.trim(),
      icon: draft.icon,
      color: draft.color,
      createdAt: now,
      updatedAt: now,
    };
    set({
      collections: watchListStorage.saveCollections([
        ...watchListStorage.getCollections(),
        collection,
      ]),
    });
    return collection;
  },

  updateCollection: (id, draft) => {
    if (id === DEFAULT_COLLECTION_ID) {
      return;
    }
    set({
      collections: watchListStorage.saveCollections(
        watchListStorage
          .getCollections()
          .map(c =>
            c.id === id
              ? {
                  ...c,
                  name: draft.name.trim(),
                  icon: draft.icon,
                  color: draft.color,
                  updatedAt: Date.now(),
                }
              : c,
          ),
      ),
    });
  },

  deleteCollection: id => {
    if (id === DEFAULT_COLLECTION_ID) {
      return;
    }
    set(watchListStorage.deleteCollection(id));
  },
}));

export default useWatchListStore;

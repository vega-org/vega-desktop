import React, { useEffect, useMemo, useState } from "react";
import {
  LuLibrary as LibraryGlyph,
  LuPencil as Pencil,
  LuPlus as Plus,
} from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { PostCardItem, type Post } from "../components/home/PostCardItem";
import { FocusableButton } from "../components/layout/FocusableButton";
import { LibraryIcon } from "../components/library/LibraryIcon";
import { LibraryCollectionDialog } from "../components/library/LibraryCollectionDialog";
import {
  DEFAULT_COLLECTION,
  getItemCollectionIds,
  type LibraryCollection,
} from "../lib/storage/WatchListStorage";
import { mainStorage } from "../lib/storage";
import useWatchListStore from "../lib/zustand/watchListStore";
import { syncFromSharedFolder } from "../lib/sync/syncService";
import "../components/home/ContentSlider.css";
import "./LibraryPage.css";

/** Chip id for every saved title, across categories. */
const ALL_FILTER = "__all__";
/** Last selected chip, kept on this device only (not synced). */
const SELECTED_FILTER_KEY = "library-selected-filter";
const NEW_CATEGORY_KEY = "LIBRARY_NEW_CATEGORY";

type EditorState = { open: false } | { open: true; collection?: LibraryCollection };

export const LibraryPage: React.FC = () => {
  const navigate = useNavigate();
  const watchList = useWatchListStore((state) => state.watchList);
  const collections = useWatchListStore((state) => state.collections);
  const removeItem = useWatchListStore((state) => state.removeItem);
  const removeFromCollection = useWatchListStore((state) => state.removeFromCollection);
  const [filter, setFilter] = useState(
    () => mainStorage.getString(SELECTED_FILTER_KEY) || ALL_FILTER,
  );
  const [editor, setEditor] = useState<EditorState>({ open: false });

  useEffect(() => {
    syncFromSharedFolder().catch((err) =>
      console.warn("[VegaSync] Library page sync failed:", err),
    );
  }, []);

  // A deleted category (here or synced from another device) falls back to All.
  const activeCollection =
    filter === ALL_FILTER
      ? undefined
      : filter === DEFAULT_COLLECTION.id
        ? DEFAULT_COLLECTION
        : collections.find((c) => c.id === filter);
  useEffect(() => {
    if (filter !== ALL_FILTER && !activeCollection) setFilter(ALL_FILTER);
  }, [filter, activeCollection]);
  useEffect(() => {
    mainStorage.setString(SELECTED_FILTER_KEY, filter);
  }, [filter]);

  const existingIds = useMemo(
    () => new Set(collections.map((c) => c.id)),
    [collections],
  );
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of watchList) {
      for (const id of getItemCollectionIds(item, existingIds)) {
        result[id] = (result[id] || 0) + 1;
      }
    }
    return result;
  }, [watchList, existingIds]);
  // Newest first, like other streaming apps' "My List".
  const visibleItems = useMemo(() => {
    const items = activeCollection
      ? watchList.filter((item) =>
          getItemCollectionIds(item, existingIds).includes(activeCollection.id),
        )
      : watchList;
    return [...items].reverse();
  }, [watchList, activeCollection, existingIds]);

  const openItem = (post: Post) => {
    const params = new URLSearchParams();
    if (post.providerValue) params.set("provider", post.providerValue);
    if (post.image) params.set("poster", post.image);
    const query = params.toString();
    navigate(
      `/watchlist/content/${encodeURIComponent(post.link)}${query ? `?${query}` : ""}`,
    );
  };

  const removePost = (post: Post) => {
    if (activeCollection) removeFromCollection([post.link], activeCollection.id);
    else removeItem(post.link);
  };

  const editableCollection =
    activeCollection && activeCollection.id !== DEFAULT_COLLECTION.id
      ? (activeCollection as LibraryCollection)
      : undefined;

  const chips = [
    { id: ALL_FILTER, name: "All", icon: "list", color: undefined, count: watchList.length },
    ...[DEFAULT_COLLECTION, ...collections].map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      count: counts[c.id] || 0,
    })),
  ];

  return (
    <main className="library-page">
      <header className="page-header library-header">
        <div className="page-header-copy">
          <h1 className="page-title">{activeCollection ? activeCollection.name : "Library"}</h1>
          <p className="page-subtitle">
            {visibleItems.length} saved {visibleItems.length === 1 ? "title" : "titles"}
          </p>
        </div>
        <div className="page-header-actions library-header-actions">
          {editableCollection && (
            <FocusableButton
              focusKey="LIBRARY_EDIT_CATEGORY"
              className="library-action-button"
              onClick={() => setEditor({ open: true, collection: editableCollection })}
              aria-label={`Edit ${editableCollection.name}`}
            >
              <Pencil size={17} /> <span>Edit</span>
            </FocusableButton>
          )}
          <FocusableButton
            focusKey={NEW_CATEGORY_KEY}
            className="library-action-button primary"
            onClick={() => setEditor({ open: true })}
            aria-label="New category"
          >
            <Plus size={18} /> <span>New category</span>
          </FocusableButton>
        </div>
      </header>

      <nav className="library-chips" aria-label="Library categories">
        {chips.map((chip) => {
          const selected = chip.id === filter;
          const isCustom = chip.id !== ALL_FILTER && chip.id !== DEFAULT_COLLECTION.id;
          return (
            <FocusableButton
              key={chip.id}
              focusKey={`LIBRARY_CHIP_${chip.id}`}
              role="tab"
              aria-selected={selected}
              className={`library-chip${selected ? " selected" : ""}`}
              onClick={() => setFilter(chip.id)}
              onContextMenu={(event) => {
                if (!isCustom) return;
                event.preventDefault();
                setEditor({
                  open: true,
                  collection: collections.find((c) => c.id === chip.id),
                });
              }}
              title={isCustom ? "Right-click to edit" : undefined}
            >
              <LibraryIcon icon={chip.icon} color={chip.color} size={17} />
              <span className="library-chip-name">{chip.name}</span>
              <span className="library-chip-count">{chip.count}</span>
            </FocusableButton>
          );
        })}
      </nav>

      {visibleItems.length > 0 ? (
        <section className="library-grid" aria-label="Saved titles">
          {visibleItems.map((item) => (
            <PostCardItem
              key={`${filter}-${item.link}`}
              post={{
                title: item.title,
                image: item.poster,
                link: item.link,
                providerValue: item.provider,
              }}
              onClick={openItem}
              onRemove={removePost}
              removeLabel={
                activeCollection ? `Remove from ${activeCollection.name}` : "Remove from library"
              }
            />
          ))}
        </section>
      ) : (
        <section className="empty-view" aria-labelledby="library-empty-title">
          <span className="empty-view-icon" aria-hidden="true">
            {activeCollection ? (
              <LibraryIcon icon={activeCollection.icon} color={activeCollection.color} size={40} />
            ) : (
              <LibraryGlyph size={40} />
            )}
          </span>
          <h2 id="library-empty-title" className="empty-view-title">
            {activeCollection ? `${activeCollection.name} is empty` : "Nothing saved yet"}
          </h2>
          <p className="empty-view-text">
            Use Save on a movie or show to keep it here. Make categories to
            keep your titles organized.
          </p>
        </section>
      )}

      <LibraryCollectionDialog
        open={editor.open}
        collection={editor.open ? editor.collection : undefined}
        onOpenChange={(open) => {
          if (!open) setEditor({ open: false });
        }}
        onSaved={(collection) => {
          if (!editor.open || !editor.collection) setFilter(collection.id);
        }}
        restoreFocusKey={NEW_CATEGORY_KEY}
      />
    </main>
  );
};

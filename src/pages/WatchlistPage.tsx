import React, { useEffect } from "react";
import { LuBookmark as Bookmark, LuSparkles as Sparkles } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { PostCardItem, type Post } from "../components/home/PostCardItem";
import useWatchListStore from "../lib/zustand/watchListStore";
import { syncFromSharedFolder } from "../lib/sync/syncService";
import "../components/home/ContentSlider.css";
import "./WatchlistPage.css";

export const WatchlistPage: React.FC = () => {
  const navigate = useNavigate();
  const { watchList, removeItem } = useWatchListStore();

  useEffect(() => {
    syncFromSharedFolder().catch((err) =>
      console.warn("[VegaSync] Watchlist page sync failed:", err),
    );
  }, []);

  const openItem = (post: Post) => {
    const params = new URLSearchParams();
    if (post.providerValue) params.set("provider", post.providerValue);
    if (post.image) params.set("poster", post.image);
    const query = params.toString();
    navigate(
      `/watchlist/content/${encodeURIComponent(post.link)}${query ? `?${query}` : ""}`,
    );
  };

  if (!watchList?.length) {
    return (
      <main className="library-page library-page-empty">
        <section
          className="library-empty-state"
          aria-labelledby="watchlist-empty-title"
        >
          <div className="library-empty-icon" aria-hidden="true">
            <Bookmark size={34} />
            <Sparkles size={16} className="library-empty-sparkle" />
          </div>
          <p className="library-eyebrow">Your library</p>
          <h1 id="watchlist-empty-title">Save something for later</h1>
          <p>
            Add movies and shows with the bookmark action and they will be ready
            here whenever you come back.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="library-page">
      <header className="library-header">
        <div className="library-header-icon" aria-hidden="true">
          <Bookmark size={26} />
        </div>
        <div>
          <p className="library-eyebrow">Your library</p>
          <h1>Watchlist</h1>
          <p className="library-header-supporting">
            {watchList.length} saved{" "}
            {watchList.length === 1 ? "title" : "titles"}
          </p>
        </div>
      </header>

      <section className="library-grid" aria-label="Saved titles">
        {watchList.map((item, index) => {
          const post: Post = {
            title: item.title,
            image: item.poster,
            link: item.link,
            providerValue: item.provider,
          };

          return (
            <PostCardItem
              key={`${item.link}-${index}`}
              post={post}
              onClick={openItem}
              onRemove={(savedPost) => removeItem(savedPost.link)}
            />
          );
        })}
      </section>
    </main>
  );
};

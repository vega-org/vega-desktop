import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Play, Trash2 } from 'lucide-react';
import useWatchListStore from '../lib/zustand/watchListStore';
import './SearchPage.css'; // Reuse search page grid styles for now
import './WatchlistPage.css';

export const WatchlistPage: React.FC = () => {
  const navigate = useNavigate();
  const { watchList, removeItem } = useWatchListStore();

  const handlePostClick = (link: string) => {
    navigate(`/content/${encodeURIComponent(link)}`);
  };

  const handleRemove = (e: React.MouseEvent, link: string) => {
    e.stopPropagation();
    removeItem(link);
  };

  if (!watchList || watchList.length === 0) {
    return (
      <div className="search-page empty-state">
        <Bookmark size={64} className="text-muted mb-md opacity-50" />
        <h2 className="headline-lg mb-sm">Your Watchlist is Empty</h2>
        <p className="body-lg text-muted">Save shows and movies to watch later by clicking the bookmark icon on their page.</p>
      </div>
    );
  }

  return (
    <div className="search-page">
      <div className="page-header">
        <div className="page-header-icon">
          <Bookmark size={36} />
        </div>
        <div className="page-header-content">
          <h1 className="display-sm">Watchlist</h1>
          <p className="body-lg text-muted">{watchList.length} saved {watchList.length === 1 ? 'item' : 'items'}</p>
        </div>
      </div>

      <div className="search-grid">
        {watchList.map((post, index) => (
          <div 
            key={`${post.link}-${index}`} 
            className="search-card watchlist-card"
            onClick={() => handlePostClick(post.link)}
          >
            <div className="search-poster-container">
              <img src={post.poster} alt={post.title} className="search-poster" loading="lazy" />
              <div className="search-hover-overlay">
                <Play size={48} fill="currentColor" />
              </div>
              <button 
                className="watchlist-remove-btn"
                onClick={(e) => handleRemove(e, post.link)}
                aria-label="Remove from watchlist"
                title="Remove from watchlist"
              >
                <Trash2 size={20} />
              </button>
            </div>
            <h3 className="search-title label-md">{post.title}</h3>
          </div>
        ))}
      </div>
    </div>
  );
};

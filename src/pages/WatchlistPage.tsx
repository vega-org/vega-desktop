import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LuBookmark as Bookmark, LuPlay as Play, LuTrash2 as Trash2 } from 'react-icons/lu';
import useWatchListStore from '../lib/zustand/watchListStore';
import { FocusableButton } from '../components/layout/FocusableButton';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation-react';
import { settingsStorage } from '../lib/storage';
import './SearchPage.css'; // Reuse search page grid styles for now
import './WatchlistPage.css';

export const WatchlistPage: React.FC = () => {
  const navigate = useNavigate();
  const { watchList, removeItem } = useWatchListStore();



  const handlePostClick = (link: string, providerValue?: string) => {
    const params = new URLSearchParams();
    if (providerValue) {
      params.append('provider', providerValue);
    }
    const queryString = params.toString();
    navigate(`/content/${encodeURIComponent(link)}${queryString ? `?${queryString}` : ''}`);
  };

  const handleRemove = (e: React.MouseEvent, link: string) => {
    e.stopPropagation();
    removeItem(link);
  };

  if (!watchList || watchList.length === 0) {
    return (
      <div className="watchlist-empty-state">
        <div className="watchlist-empty-icon-container">
          <Bookmark size={64} className="text-muted opacity-50" />
          <div className="watchlist-empty-icon-glow" />
        </div>
        <h2 className="headline-lg mb-sm">Your Watchlist is Empty</h2>
        <p className="body-lg text-muted" style={{ maxWidth: '480px' }}>Save shows and movies to watch later by clicking the bookmark icon on their page.</p>
      </div>
    );
  }

  return (
    <div className="watchlist-page">
      <div className="page-header">
        <div className="page-header-icon">
          <Bookmark size={28} />
        </div>
        <div className="page-header-content">
          <h1>Watchlist</h1>
          <p className="body-md text-muted">{watchList.length} saved {watchList.length === 1 ? 'item' : 'items'}</p>
        </div>
      </div>

      <div className="search-grid">
        {watchList.map((post, index) => (
          <div key={`${post.link}-${index}`} className="search-card watchlist-card">
            <WatchlistCardClickable onClick={() => handlePostClick(post.link, post.provider)}>
              <img src={post.poster} alt={post.title} className="search-poster" loading="lazy" />
              <div className="search-hover-overlay">
                <Play size={48} fill="currentColor" />
              </div>
              <FocusableButton 
                className="watchlist-remove-btn"
                onClick={(e: any) => handleRemove(e, post.link)}
                aria-label="Remove from watchlist"
                title="Remove from watchlist"
              >
                <Trash2 size={20} />
              </FocusableButton>
            </WatchlistCardClickable>
            <h3 className="search-title label-md">{post.title}</h3>
          </div>
        ))}
      </div>
    </div>
  );
};

const WatchlistCardClickable: React.FC<{children: React.ReactNode, onClick: () => void}> = ({children, onClick}) => {
  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref, focused } = useFocusable({
    focusable: tvMode,
    onEnterPress: onClick,
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  });

  return (
    <div 
      ref={ref as any}
      className={`search-poster-container ${focused ? 'tv-focus' : ''}`}
      onClick={onClick}
      style={{ cursor: 'pointer', outlineOffset: '4px' }}
    >
      {children}
    </div>
  );
};

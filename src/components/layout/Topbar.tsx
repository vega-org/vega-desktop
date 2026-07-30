import React, { useState, useRef, useEffect } from 'react';
import { LuSearch as Search } from 'react-icons/lu';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ProviderSwitcher } from './ProviderSwitcher';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation-react';
import { resume } from '@noriginmedia/norigin-spatial-navigation-core';
import { settingsStorage } from '../../lib/storage';
import './Topbar.css';

export const Topbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(urlQuery);
  const [isTyping, setIsTyping] = useState(false);
  const nativeInputRef = useRef<HTMLInputElement>(null);

  // Sync input value with URL query parameters
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  const isAndroid = navigator.userAgent.toLowerCase().includes('android');
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref: focusRef, focused, focusSelf } = useFocusable({
    focusable: tvMode,
    onEnterPress: () => {
      setIsTyping(true);
      setTimeout(() => {
        nativeInputRef.current?.focus();
      }, 50);
    }
  });

  if (location.pathname !== '/') {
    return null;
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/?q=${encodeURIComponent(query.trim())}`);
    } else {
      navigate(`/`);
    }
  };

  const handleInputBlur = () => {
    setIsTyping(false);
    setTimeout(() => {
      resume();
      focusSelf();
    }, 100);
  };

  return (
    <header className="topbar">
      <form className="search-container" onSubmit={handleSearch}>
        <div 
          // @ts-ignore
          ref={focusRef}
          className={`search-form-inner ${focused ? 'tv-focus' : ''}`}
          onClick={() => {
            setIsTyping(true);
            setTimeout(() => nativeInputRef.current?.focus(), 50);
          }}
          style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', padding: 0, outline: 'none', width: '100%', cursor: 'text' }}
        >
          <Search size={20} className="search-icon" />
          <input 
            ref={nativeInputRef}
            type="text" 
            tabIndex={-1}
            readOnly={tvMode ? !isTyping : false}
            placeholder="Search movies, TV shows..." 
            className="search-input body-md"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onBlur={handleInputBlur}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                nativeInputRef.current?.blur();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                nativeInputRef.current?.blur();
                handleSearch(e as any);
              }
            }}
            style={{ width: '100%', flex: 1, background: 'transparent', border: 'none', outline: 'none' }}
          />
        </div>
      </form>
      <div className="topbar-actions">
        <ProviderSwitcher />
      </div>
    </header>
  );
};

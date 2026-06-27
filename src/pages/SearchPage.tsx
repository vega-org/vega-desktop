import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { LuSearch as Search, LuLoaderCircle as Loader2 } from 'react-icons/lu';
import { useGlobalSearch } from '../lib/hooks/useGlobalSearch';
import { ContentSlider } from '../components/home/ContentSlider';

import { FocusableButton } from '../components/layout/FocusableButton';
import './SearchPage.css';

export const SearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const navigate = useNavigate();
  const [localQuery, setLocalQuery] = useState(query);

  const nativeInputRef = useRef<HTMLInputElement>(null);

  const { searchData, emptyResults, loading, isAllLoaded } = useGlobalSearch(query);



  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (localQuery.trim()) {
      nativeInputRef.current?.blur();
      navigate(`/search?q=${encodeURIComponent(localQuery.trim())}`);
    }
  };

  const hasAnyResults = searchData.length > 0;
  const isCurrentlyLoading = loading.some(l => l.isLoading);

  return (
    <div className="search-page">
      <div className="search-page-header-container">
        <div className="search-page-form">
          <FocusableButton
            className="search-page-form-inner"
            onClick={() => nativeInputRef.current?.focus()}
            style={{ flex: 1, gap: "8px", display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', padding: 0, outline: 'none' }}
          >
            <Search size={25} className="search-page-icon text-muted" />
            <input
              ref={nativeInputRef}
              type="text"
              placeholder="Search all providers..."
              className="search-page-input"
              value={localQuery}
              onChange={e => setLocalQuery(e.target.value)}
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
              autoFocus
            />
          </FocusableButton>
        </div>
        {isCurrentlyLoading && (
          <Loader2 size={24} className="spin text-primary ml-auto" />
        )}
      </div>

      {!query ? (
        <div className="search-page-empty">
          <Search size={64} className="text-muted mb-md opacity-50" />
          <h2 className="headline-lg mb-sm">Discover Content</h2>
          <p className="body-lg text-muted">Type in the search bar above to search across all installed providers.</p>
        </div>
      ) : (
        <div className="search-results-meta mb-md flex justify-between items-center">
          <p className="body-lg text-muted">
            {isAllLoaded ? 'Searched for' : 'Searching for'} <span className="text-primary">"{query}"</span>
          </p>
        </div>
      )}

      {query && !isCurrentlyLoading && !hasAnyResults && emptyResults.length > 0 && (
        <div className="empty-state">
          <h2 className="headline-md">No results found</h2>
          <p className="body-lg text-muted">Try adjusting your search terms.</p>
        </div>
      )}

      {query && (
        <div className="search-sliders-container">
          {searchData.map((data) => (
            <ContentSlider
              key={`data-${data.providerValue}`}
              title={data.title}
              posts={data.Posts}
              providerValue={data.providerValue}
              isLoading={loading.find(l => l.value === data.providerValue)?.isLoading}
            />
          ))}

          {emptyResults.map((data) => (
            <ContentSlider
              key={`empty-${data.providerValue}`}
              title={data.title}
              posts={data.Posts}
              providerValue={data.providerValue}
              isLoading={loading.find(l => l.value === data.providerValue)?.isLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
};

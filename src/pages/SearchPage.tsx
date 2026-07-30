import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { LuSearch as Search, LuLoaderCircle as Loader2, LuArrowLeft as ArrowLeft } from 'react-icons/lu';
import { useGlobalSearch } from '../lib/hooks/useGlobalSearch';
import { ContentSlider } from '../components/home/ContentSlider';

import { FocusableButton } from '../components/layout/FocusableButton';
import './SearchPage.css';

const RECOMMENDED_TAGS = [
  "Action",
  "Comedy",
  "Sci-Fi",
  "Drama",
  "Anime",
  "Horror",
  "Documentary"
];

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

  const handleBack = () => {
    if (query) {
      setLocalQuery('');
      navigate('/search');
    } else {
      navigate('/');
    }
  };

  const hasAnyResults = searchData.length > 0;
  const isCurrentlyLoading = loading.some(l => l.isLoading);

  return (
    <div className="search-page">
      <div className="search-page-header-container">
        <FocusableButton
          className="icon-btn back-btn glass-overlay"
          onClick={handleBack}
          title={query ? "Clear search" : "Go back"}
        >
          <ArrowLeft size={24} />
        </FocusableButton>

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
          <div className="search-icon-glow-container">
            <Search size={64} className="search-empty-icon text-muted opacity-50" />
            <div className="search-icon-glow" />
          </div>
          <h2 className="headline-lg mb-sm">Discover Content</h2>
          <p className="body-lg text-muted mb-lg">Type in the search bar above to search across all installed providers.</p>

          <div className="search-tags-container">
            <h3 className="label-lg text-muted mb-sm">Recommended Searches</h3>
            <div className="search-tags-grid">
              {RECOMMENDED_TAGS.map(tag => (
                <FocusableButton
                  key={tag}
                  className="search-tag-chip"
                  onClick={() => {
                    setLocalQuery(tag);
                    navigate(`/search?q=${encodeURIComponent(tag)}`);
                  }}
                >
                  {tag}
                </FocusableButton>
              ))}
            </div>
          </div>
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
            <div className="search-provider-slider-wrap" key={`data-${data.providerValue}`}>
              <ContentSlider
                title={data.title}
                posts={data.Posts}
                providerValue={data.providerValue}
                isLoading={loading.find(l => l.value === data.providerValue)?.isLoading}
              />
            </div>
          ))}

          {emptyResults.map((data) => (
            <div className="search-provider-slider-wrap" key={`empty-${data.providerValue}`}>
              <ContentSlider
                title={data.title}
                posts={data.Posts}
                providerValue={data.providerValue}
                isLoading={loading.find(l => l.value === data.providerValue)?.isLoading}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LuSearch as Search, LuX as X } from "react-icons/lu";
import { useGlobalSearch } from "../lib/hooks/useGlobalSearch";
import { ContentSlider } from "../components/home/ContentSlider";
import { FocusableButton } from "../components/layout/FocusableButton";
import { Spinner } from "../components/ui/spinner";
import "./SearchPage.css";

export const SearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const navigate = useNavigate();
  const [localQuery, setLocalQuery] = useState(query);

  const nativeInputRef = useRef<HTMLInputElement>(null);

  const { searchData, emptyResults, loading, isAllLoaded } =
    useGlobalSearch(query);

  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  const submitSearch = () => {
    if (localQuery.trim()) {
      nativeInputRef.current?.blur();
      navigate(`/search?q=${encodeURIComponent(localQuery.trim())}`);
    }
  };

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    submitSearch();
  };

  const clearSearch = () => {
    setLocalQuery("");
    navigate("/search");
    nativeInputRef.current?.focus();
  };

  const hasAnyResults = searchData.length > 0;
  const isCurrentlyLoading = loading.some((l) => l.isLoading);

  return (
    <div className="search-page">
      <div className="search-page-header-container">
        <form className="search-page-form" onSubmit={handleSearch}>
          <div className="search-page-form-inner">
            <Search size={23} className="search-page-icon" aria-hidden="true" />
            <input
              ref={nativeInputRef}
              type="text"
              placeholder="Search all providers..."
              aria-label="Search all providers"
              className="search-page-input"
              value={localQuery}
              onChange={(event) => setLocalQuery(event.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  clearSearch();
                }
              }}
              autoFocus
            />
            {localQuery && (
              <button
                type="button"
                className="search-page-clear"
                onClick={clearSearch}
                aria-label="Clear search"
              >
                <X size={19} />
              </button>
            )}
          </div>
          <FocusableButton
            className="search-page-submit"
            onClick={submitSearch}
            disabled={!localQuery.trim()}
          >
            <Search size={19} aria-hidden="true" />
            <span>Search</span>
          </FocusableButton>
        </form>
        {isCurrentlyLoading && (
          <Spinner size={26} label="Searching providers" />
        )}
      </div>

      {!query ? (
        <div className="search-page-empty">
          <span className="search-empty-icon">
            <Search size={34} />
          </span>
          <h2 className="headline-lg">Discover content</h2>
          <p className="body-lg text-muted">
            Search across all installed providers from one place.
          </p>
        </div>
      ) : (
        <div className="search-results-meta">
          <p className="body-lg text-muted">
            {isAllLoaded ? "Searched for" : "Searching for"}{" "}
            <span className="text-primary">"{query}"</span>
          </p>
        </div>
      )}

      {query &&
        !isCurrentlyLoading &&
        !hasAnyResults &&
        emptyResults.length > 0 && (
          <div className="empty-state">
            <h2 className="headline-md">No results found</h2>
            <p className="body-lg text-muted">
              Try adjusting your search terms.
            </p>
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
              isLoading={
                loading.find((l) => l.value === data.providerValue)?.isLoading
              }
            />
          ))}

          {emptyResults.map((data) => (
            <ContentSlider
              key={`empty-${data.providerValue}`}
              title={data.title}
              posts={data.Posts}
              providerValue={data.providerValue}
              isLoading={
                loading.find((l) => l.value === data.providerValue)?.isLoading
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};

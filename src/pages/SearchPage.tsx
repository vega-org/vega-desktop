import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LuSearch as Search, LuX as X } from "react-icons/lu";
import { useGlobalSearch } from "../lib/hooks/useGlobalSearch";
import { ContentSlider } from "../components/home/ContentSlider";
import { FocusableButton } from "../components/layout/FocusableButton";
import { Spinner } from "../components/ui/spinner";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { resume } from "@noriginmedia/norigin-spatial-navigation-core";
import { settingsStorage } from "../lib/storage";
import "./SearchPage.css";

export const SearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const navigate = useNavigate();
  const [localQuery, setLocalQuery] = useState(query);
  const [isTyping, setIsTyping] = useState(false);

  const nativeInputRef = useRef<HTMLInputElement>(null);
  const isAndroid = navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;
  const {
    ref: searchFocusRef,
    focused: searchFocused,
    focusSelf: focusSearch,
  } = useFocusable({
    focusable: tvMode,
    onEnterPress: () => {
      setIsTyping(true);
      window.setTimeout(() => nativeInputRef.current?.focus(), 0);
    },
  });

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

  const stopTyping = () => {
    setIsTyping(false);
    window.setTimeout(() => {
      resume();
      focusSearch();
    }, 0);
  };

  const hasAnyResults = searchData.length > 0;
  const isCurrentlyLoading = loading.some((l) => l.isLoading);

  return (
    <div className="search-page">
      <div className="search-page-header-container">
        <form className="search-page-form" onSubmit={handleSearch}>
          <div
            ref={searchFocusRef}
            className={`search-page-form-inner ${searchFocused ? "tv-focus" : ""}`}
            onClick={() => {
              setIsTyping(true);
              window.setTimeout(() => nativeInputRef.current?.focus(), 0);
            }}
          >
            <Search size={23} className="search-page-icon" aria-hidden="true" />
            <input
              ref={nativeInputRef}
              type="text"
              placeholder="Search all providers..."
              aria-label="Search all providers"
              className="search-page-input"
              tabIndex={tvMode ? -1 : 0}
              readOnly={tvMode ? !isTyping : false}
              value={localQuery}
              onChange={(event) => setLocalQuery(event.target.value)}
              onBlur={stopTyping}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (
                  e.key === "Escape" ||
                  e.key === "ArrowDown" ||
                  e.key === "ArrowUp"
                ) {
                  e.preventDefault();
                  nativeInputRef.current?.blur();
                }
              }}
              autoFocus={!tvMode}
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

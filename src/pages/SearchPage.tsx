import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LuSearch as Search, LuX as X, LuTv as Tv, LuFilm as Film } from "react-icons/lu";
import { useGlobalSearch } from "../lib/hooks/useGlobalSearch";
import { ContentSlider } from "../components/home/ContentSlider";
import { FocusableButton } from "../components/layout/FocusableButton";
import { Spinner } from "../components/ui/spinner";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { resume, setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { fetchIMDbSuggestions, type IMDbSuggestion } from "../lib/services/imdbSuggestions";
import { settingsStorage } from "../lib/storage";
import "./SearchPage.css";

const FocusableSuggestionItem: React.FC<{
  item: IMDbSuggestion;
  focusKey: string;
  onSelect: (title: string) => void;
  tvMode: boolean;
}> = ({ item, focusKey, onSelect, tvMode }) => {
  const { ref, focused } = useFocusable({
    focusable: tvMode,
    focusKey,
    onEnterPress: () => {
      onSelect(item.title);
    },
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  return (
    <button
      ref={ref as any}
      type="button"
      className={`search-suggestion-item ${focused ? "tv-focus" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(item.title);
      }}
      onClick={() => onSelect(item.title)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(item.title);
        }
      }}
    >
      <div className="search-suggestion-content">
        {item.type === "tv" ? (
          <Tv size={16} className="search-suggestion-icon" />
        ) : (
          <Film size={16} className="search-suggestion-icon" />
        )}
        <span className="search-suggestion-title">{item.title}</span>
      </div>
    </button>
  );
};

export const SearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const navigate = useNavigate();
  const [localQuery, setLocalQuery] = useState(query);
  const [isTyping, setIsTyping] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<IMDbSuggestion[]>([]);

  const nativeInputRef = useRef<HTMLInputElement>(null);
  const navigatingToSuggestionsRef = useRef(false);
  const suppressSuggestionsRef = useRef(true);
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

  const { ref: suggestionsContainerRef, focusKey: suggestionsFocusKey } =
    useFocusable({
      focusable: false,
      trackChildren: true,
    });

  const { searchData, emptyResults, loading, isAllLoaded } =
    useGlobalSearch(query);

  useEffect(() => {
    suppressSuggestionsRef.current = true;
    setLocalQuery(query);
  }, [query]);

  // Debounced IMDb search suggestions
  useEffect(() => {
    const clean = localQuery.trim();
    if (clean.length < 3 || suppressSuggestionsRef.current) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const results = await fetchIMDbSuggestions(clean, controller.signal);
      setSuggestions(results);
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [localQuery]);

  const submitSearch = () => {
    suppressSuggestionsRef.current = true;
    setSuggestions([]);
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
    suppressSuggestionsRef.current = false;
    setLocalQuery("");
    setSuggestions([]);
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

  const handleSelectSuggestion = (title: string) => {
    suppressSuggestionsRef.current = true;
    setLocalQuery(title);
    if (nativeInputRef.current) {
      nativeInputRef.current.value = title;
    }
    setSuggestions([]);
    if (tvMode) {
      resume();
      focusSearch();
    } else {
      nativeInputRef.current?.focus();
    }
  };

  const hasAnyResults = searchData.length > 0;
  const isCurrentlyLoading = loading.some((l) => l.isLoading);
  const showSuggestions =
    (isInputFocused || isTyping) &&
    localQuery.trim().length >= 3 &&
    suggestions.length > 0;

  return (
    <div className="search-page">
      <div className="search-page-header-container">
        <div className="search-page-form-wrapper">
          <form className="search-page-form" onSubmit={handleSearch}>
            <div
              ref={searchFocusRef}
              className={`search-page-form-inner ${searchFocused ? "tv-focus" : ""}`}
              onClick={() => {
                setIsTyping(true);
                window.setTimeout(() => nativeInputRef.current?.focus(), 0);
              }}
            >
              <Search size={17} className="search-page-icon" aria-hidden="true" />
              <input
                ref={nativeInputRef}
                type="text"
                placeholder="Search all providers..."
                aria-label="Search all providers"
                className="search-page-input"
                tabIndex={tvMode ? -1 : 0}
                readOnly={tvMode ? !isTyping : false}
                value={localQuery}
                onChange={(event) => {
                  suppressSuggestionsRef.current = false;
                  setLocalQuery(event.target.value);
                }}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => {
                  if (navigatingToSuggestionsRef.current) {
                    navigatingToSuggestionsRef.current = false;
                    return;
                  }
                  stopTyping();
                  setTimeout(() => setIsInputFocused(false), 200);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "ArrowDown" && showSuggestions && tvMode) {
                    e.preventDefault();
                    navigatingToSuggestionsRef.current = true;
                    setIsTyping(false);
                    nativeInputRef.current?.blur();
                    window.setTimeout(() => {
                      resume();
                      setFocus("suggestion-item-0");
                    }, 0);
                    return;
                  }
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
                  <X size={16} />
                </button>
              )}
            </div>
            <FocusableButton
              className="search-page-submit"
              onClick={submitSearch}
              disabled={!localQuery.trim()}
            >
              <span>Search</span>
            </FocusableButton>
          </form>

          {showSuggestions && (
            <FocusContext.Provider value={suggestionsFocusKey}>
              <div
                ref={suggestionsContainerRef}
                className="search-suggestions-dropdown"
              >
                {suggestions.map((item, index) => (
                  <FocusableSuggestionItem
                    key={`${item.title}-${index}`}
                    item={item}
                    focusKey={`suggestion-item-${index}`}
                    onSelect={handleSelectSuggestion}
                    tvMode={tvMode}
                  />
                ))}
              </div>
            </FocusContext.Provider>
          )}
        </div>
        {isCurrentlyLoading && (
          <Spinner size={20} label="Searching providers" />
        )}
      </div>

      {!query ? (
        <section className="empty-view" aria-labelledby="search-empty-title">
          <Search size={40} className="empty-view-icon" aria-hidden="true" />
          <h2 id="search-empty-title" className="empty-view-title">
            Search all providers
          </h2>
          <p className="empty-view-text">
            Results from every installed provider show up here, one row per
            provider.
          </p>
        </section>
      ) : (
        <div className="search-results-meta">
          <p>
            {isAllLoaded ? "Searched for" : "Searching for"}{" "}
            <span className="text-primary">"{query}"</span>
          </p>
        </div>
      )}

      {query &&
        !isCurrentlyLoading &&
        !hasAnyResults &&
        emptyResults.length > 0 && (
          <section className="empty-view search-no-results">
            <h2 className="empty-view-title">No results found</h2>
            <p className="empty-view-text">Try a different title or spelling.</p>
          </section>
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

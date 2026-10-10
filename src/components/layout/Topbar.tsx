import React, { useEffect, useRef, useState } from "react";
import {
  LuSearch as Search,
  LuX as X,
  LuTv as Tv,
  LuFilm as Film,
} from "react-icons/lu";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { resume, setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { settingsStorage } from "../../lib/storage";
import {
  fetchIMDbSuggestions,
  type IMDbSuggestion,
} from "../../lib/services/imdbSuggestions";
import { ProviderSwitcher } from "./ProviderSwitcher";
import { isWindowsPlatform, toggleWindowMaximize } from "./WindowControls";
import "./Topbar.css";

const FocusableSuggestionItem: React.FC<{
  item: IMDbSuggestion;
  index: number;
  onSelect: (title: string) => void;
  tvMode: boolean;
  onItemFocus: () => void;
  onItemBlur: () => void;
}> = ({ item, index, onSelect, tvMode, onItemFocus, onItemBlur }) => {
  const { ref, focused } = useFocusable({
    focusKey: `topbar-suggestion-${index}`,
    focusable: tvMode,
    onEnterPress: () => {
      onSelect(item.title);
    },
    onFocus: (layout) => {
      onItemFocus();
      layout?.node?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    },
    onBlur: () => {
      onItemBlur();
    },
  });

  return (
    <button
      ref={ref as any}
      type="button"
      className={`search-suggestion-item ${tvMode && focused ? "tv-focus" : ""}`}
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
          <Tv size={16} className="search-suggestion-icon" aria-hidden="true" />
        ) : (
          <Film
            size={16}
            className="search-suggestion-icon"
            aria-hidden="true"
          />
        )}
        <span className="search-suggestion-title">{item.title}</span>
      </div>
    </button>
  );
};

export const Topbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(activeQuery);
  const [isTyping, setIsTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<IMDbSuggestion[]>([]);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isSuggestionsFocused, setIsSuggestionsFocused] = useState(false);
  const suppressSuggestionsRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);
  const navigatingToSuggestionsRef = useRef(false);

  const tvMode = settingsStorage.isTvModeEnabled();

  const {
    ref: focusRef,
    focused,
    focusSelf,
  } = useFocusable({
    focusKey: "TOPBAR_SEARCH_INPUT",
    focusable: tvMode,
    onEnterPress: () => {
      setIsTyping(true);
      setIsInputFocused(true);
      setTimeout(() => {
        nativeInputRef.current?.focus();
      }, 50);
    },
  });

  const { focusKey: suggestionsFocusKey } = useFocusable({
    focusKey: "TOPBAR_SUGGESTIONS_GROUP",
    focusable: false,
    trackChildren: true,
  });

  useEffect(() => {
    suppressSuggestionsRef.current = true;
    setQuery(activeQuery);
  }, [activeQuery]);

  // Debounced IMDb search suggestions
  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2 || suppressSuggestionsRef.current) {
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
  }, [query]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setSuggestions([]);
        setIsInputFocused(false);
        setIsSuggestionsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Over the hero the bar is transparent; once the page scrolls it becomes a
  // solid title bar so posters do not slide under the search box.
  const [scrolled, setScrolled] = useState(false);
  const isHome = location.pathname === "/";
  useEffect(() => {
    if (!isHome) return;
    const scroller = document.querySelector(".layout-content");
    if (!scroller) return;
    const update = () => setScrolled(scroller.scrollTop > 24);
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, [isHome]);

  if (location.pathname !== "/") {
    return null;
  }

  const submitSearch = (searchVal?: string) => {
    const targetQuery = (searchVal ?? query).trim();
    suppressSuggestionsRef.current = true;
    setSuggestions([]);
    setIsInputFocused(false);
    setIsSuggestionsFocused(false);
    nativeInputRef.current?.blur();
    if (targetQuery) {
      navigate(`/?q=${encodeURIComponent(targetQuery)}`);
    } else {
      navigate(`/`);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    submitSearch();
  };

  const handleSelectSuggestion = (title: string) => {
    suppressSuggestionsRef.current = true;
    setQuery(title);
    if (nativeInputRef.current) {
      nativeInputRef.current.value = title;
    }
    setSuggestions([]);
    setIsSuggestionsFocused(false);
    if (tvMode) {
      resume();
      focusSelf();
    } else {
      nativeInputRef.current?.focus();
    }
  };

  const clearSearch = () => {
    suppressSuggestionsRef.current = false;
    setQuery("");
    setSuggestions([]);
    setIsSuggestionsFocused(false);
    navigate("/");
    nativeInputRef.current?.focus();
  };

  const handleInputBlur = () => {
    if (navigatingToSuggestionsRef.current) {
      navigatingToSuggestionsRef.current = false;
      return;
    }
    setIsTyping(false);
    setTimeout(() => {
      setIsInputFocused(false);
      if (tvMode) {
        resume();
        focusSelf();
      }
    }, 150);
  };

  const showSuggestions =
    suggestions.length > 0 &&
    (isInputFocused || isTyping || isSuggestionsFocused || (tvMode && focused));

  return (
    <header
      className={`topbar${scrolled ? " scrolled" : ""}`}
      {...(isWindowsPlatform() ? { "data-tauri-drag-region": true } : {})}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget && isWindowsPlatform()) {
          void toggleWindowMaximize().catch(() => {});
        }
      }}
    >
      <div ref={containerRef} className="search-wrapper">
        <form className="search-container" onSubmit={handleSearch}>
          <div
            ref={focusRef}
            className={`search-form-inner ${tvMode && focused ? "tv-focus" : ""}`}
            onClick={() => {
              setIsTyping(true);
              setIsInputFocused(true);
              setTimeout(() => nativeInputRef.current?.focus(), 50);
            }}
          >
            <Search size={17} className="search-icon" aria-hidden="true" />
            <input
              ref={nativeInputRef}
              type="text"
              tabIndex={tvMode ? -1 : 0}
              readOnly={tvMode ? !isTyping : false}
              placeholder="Search this provider"
              aria-label="Search this provider"
              className="search-input"
              value={query}
              onFocus={() => {
                suppressSuggestionsRef.current = false;
                setIsInputFocused(true);
              }}
              onChange={(event) => {
                suppressSuggestionsRef.current = false;
                setQuery(event.target.value);
              }}
              onBlur={handleInputBlur}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "ArrowDown" && showSuggestions && tvMode) {
                  e.preventDefault();
                  navigatingToSuggestionsRef.current = true;
                  setIsTyping(false);
                  setIsSuggestionsFocused(true);
                  nativeInputRef.current?.blur();
                  window.setTimeout(() => {
                    resume();
                    setFocus("topbar-suggestion-0");
                  }, 20);
                  return;
                }
                if (
                  e.key === "Escape" ||
                  e.key === "ArrowDown" ||
                  e.key === "ArrowUp"
                ) {
                  e.preventDefault();
                  setSuggestions([]);
                  nativeInputRef.current?.blur();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  submitSearch();
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                aria-label="Clear search"
                onClick={(event) => {
                  event.stopPropagation();
                  clearSearch();
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>
        </form>

        {showSuggestions && (
          <FocusContext.Provider value={suggestionsFocusKey}>
            <div className="topbar-suggestions-dropdown">
              {suggestions.map((item, index) => (
                <FocusableSuggestionItem
                  key={`${item.title}-${index}`}
                  item={item}
                  index={index}
                  onSelect={handleSelectSuggestion}
                  tvMode={tvMode}
                  onItemFocus={() => setIsSuggestionsFocused(true)}
                  onItemBlur={() => {
                    setTimeout(() => {
                      setIsSuggestionsFocused(false);
                    }, 200);
                  }}
                />
              ))}
            </div>
          </FocusContext.Provider>
        )}
      </div>

      <div className="topbar-actions">
        <ProviderSwitcher />
      </div>
    </header>
  );
};

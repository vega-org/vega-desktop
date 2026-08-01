import React, { useEffect, useRef, useState } from "react";
import { LuSearch as Search, LuX as X } from "react-icons/lu";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { resume } from "@noriginmedia/norigin-spatial-navigation-core";
import { settingsStorage } from "../../lib/storage";
import { ProviderSwitcher } from "./ProviderSwitcher";
import "./Topbar.css";

export const Topbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(activeQuery);
  const [isTyping, setIsTyping] = useState(false);
  const nativeInputRef = useRef<HTMLInputElement>(null);

  const isAndroid = navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const {
    ref: focusRef,
    focused,
    focusSelf,
  } = useFocusable({
    focusable: tvMode,
    onEnterPress: () => {
      setIsTyping(true);
      setTimeout(() => {
        nativeInputRef.current?.focus();
      }, 50);
    },
  });

  useEffect(() => {
    setQuery(activeQuery);
  }, [activeQuery]);

  if (location.pathname !== "/") {
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

  const clearSearch = () => {
    setQuery("");
    navigate("/");
    nativeInputRef.current?.focus();
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
          ref={focusRef}
          className={`search-form-inner ${focused ? "tv-focus" : ""}`}
          onClick={() => {
            setIsTyping(true);
            setTimeout(() => nativeInputRef.current?.focus(), 50);
          }}
        >
          <Search size={21} className="search-icon" aria-hidden="true" />
          <input
            ref={nativeInputRef}
            type="text"
            tabIndex={-1}
            readOnly={tvMode ? !isTyping : false}
            placeholder="Search this provider"
            aria-label="Search this provider"
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onBlur={handleInputBlur}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (
                e.key === "Escape" ||
                e.key === "ArrowDown" ||
                e.key === "ArrowUp"
              ) {
                e.preventDefault();
                nativeInputRef.current?.blur();
              } else if (e.key === "Enter") {
                e.preventDefault();
                nativeInputRef.current?.blur();
                handleSearch(e);
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
      <div className="topbar-actions">
        <ProviderSwitcher />
      </div>
    </header>
  );
};

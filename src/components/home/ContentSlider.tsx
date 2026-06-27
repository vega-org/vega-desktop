import React, { useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  LuChevronLeft as ChevronLeft,
  LuChevronRight as ChevronRight,
} from "react-icons/lu";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import { PostCardItem, Post } from "./PostCardItem";
import { FocusableButton } from "../layout/FocusableButton";
import "./ContentSlider.css";

interface ContentSliderProps {
  title: string;
  posts: Post[];
  isLoading?: boolean;
  providerValue?: string;
  filter?: string;
  searchQuery?: string;
  onRemove?: (post: Post, e: React.MouseEvent) => void;
}

export const ContentSlider: React.FC<ContentSliderProps> = ({
  title,
  posts,
  isLoading,
  providerValue,
  filter,
  searchQuery,
  onRemove,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const tvMode = settingsStorage.isTvModeEnabled();

  const {
    ref: focusRef,
    focusKey,
    hasFocusedChild,
  } = useFocusable({
    focusable: tvMode,
    trackChildren: true,
  });

  const handleScroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.8;
      const targetScroll =
        scrollRef.current.scrollLeft +
        (direction === "left" ? -scrollAmount : scrollAmount);
      scrollRef.current.scrollTo({
        left: targetScroll,
        behavior: "smooth",
      });
    }
  };

  const handlePostClick = (post: Post) => {
    const finalProvider = post.providerValue || providerValue;

    if (finalProvider === "local") {
      if (post.type === "series") {
        navigate(`/downloads/series/${encodeURIComponent(post.title)}`);
      } else {
        navigate("/downloads");
      }
      return;
    }

    let url = `/content/${encodeURIComponent(post.link)}`;
    const params = new URLSearchParams();
    if (finalProvider) params.append("provider", finalProvider);
    if (post.image) params.append("poster", post.image);

    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
    navigate(url);
  };

  if (isLoading) {
    return (
      <div className="slider-container">
        <h2
          className="slider-title headline-md skeleton-text"
          style={{ width: "200px" }}
        />
        <div className="slider-row skeleton-row">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="post-card skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return null;
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        className={`slider-container ${hasFocusedChild ? "has-focused-child" : ""}`}
        ref={focusRef as any}
      >
        <div className="slider-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h2 className="slider-title headline-md" style={{ marginBottom: 0 }}>{title}</h2>
          {(typeof filter === 'string' || typeof searchQuery === 'string') && (
            <FocusableButton 
              className="text-primary body-md"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 16px', outline: 'none' }}
              onClick={() => {
                if (typeof searchQuery === 'string') {
                  navigate(`/catalog?title=${encodeURIComponent(title)}&searchQuery=${encodeURIComponent(searchQuery)}&provider=${encodeURIComponent(providerValue || '')}`);
                } else {
                  navigate(`/catalog?title=${encodeURIComponent(title)}&filter=${encodeURIComponent(filter || '')}&provider=${encodeURIComponent(providerValue || '')}`);
                }
              }}
            >
              More
            </FocusableButton>
          )}
        </div>

        <div className="slider-wrapper">
          <button
            className="slider-arrow left glass-overlay"
            onClick={() => handleScroll("left")}
            aria-label="Scroll left"
          >
            <ChevronLeft size={32} />
          </button>

          <div className="slider-row" ref={scrollRef}>
            {posts.map((post, index) => (
              <PostCardItem
                key={`${post.link}-${index}`}
                post={post}
                onClick={handlePostClick}
                onRemove={onRemove}
              />
            ))}
          </div>

          <button
            className="slider-arrow right glass-overlay"
            onClick={() => handleScroll("right")}
            aria-label="Scroll right"
          >
            <ChevronRight size={32} />
          </button>
        </div>
      </div>
    </FocusContext.Provider>
  );
};

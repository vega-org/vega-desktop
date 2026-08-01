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
import { Skeleton } from "../ui/skeleton";
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
        <Skeleton className="slider-title-skeleton" />
        <div className="slider-row skeleton-row">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="post-card">
              <Skeleton className="skeleton-card" />
              <Skeleton className="skeleton-card-title" />
            </div>
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
        <div className="slider-header">
          <h2 className="slider-title headline-md">{title}</h2>
          {(typeof filter === "string" || typeof searchQuery === "string") && (
            <FocusableButton
              className="slider-see-all"
              onClick={() => {
                if (typeof searchQuery === "string") {
                  navigate(
                    `/catalog?title=${encodeURIComponent(title)}&searchQuery=${encodeURIComponent(searchQuery)}&provider=${encodeURIComponent(providerValue || "")}`,
                  );
                } else {
                  navigate(
                    `/catalog?title=${encodeURIComponent(title)}&filter=${encodeURIComponent(filter || "")}&provider=${encodeURIComponent(providerValue || "")}`,
                  );
                }
              }}
            >
              View all
            </FocusableButton>
          )}
        </div>

        <div className="slider-wrapper">
          <button
            className="slider-arrow left"
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
            className="slider-arrow right"
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

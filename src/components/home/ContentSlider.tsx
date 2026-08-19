import React, { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Swiper, SwiperSlide } from "swiper/react";
import { FreeMode, Mousewheel } from "swiper/modules";
import type { Swiper as SwiperInstance } from "swiper";
import "swiper/css";
import {
  LuChevronLeft as ChevronLeft,
  LuChevronRight as ChevronRight,
} from "react-icons/lu";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
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
  const swiperRef = useRef<SwiperInstance | null>(null);
  const navigate = useNavigate();
  const sanitizedTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_");

  const {
    ref: focusRef,
    focusKey,
    hasFocusedChild,
  } = useFocusable({
    trackChildren: true,
  });

  const handleScroll = (direction: "left" | "right") => {
    if (direction === "left") swiperRef.current?.slidePrev();
    else swiperRef.current?.slideNext();
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
            tabIndex={-1}
          >
            <ChevronLeft size={32} />
          </button>

          <Swiper
            className="slider-row"
            modules={[Mousewheel, FreeMode]}
            onSwiper={(swiper) => {
              swiperRef.current = swiper;
            }}
            slidesPerView="auto"
            slidesPerGroupAuto
            spaceBetween={16}
            speed={320}
            freeMode={{
              enabled: true,
              momentum: true,
              sticky: false,
            }}
            mousewheel={{
              enabled: true,
              forceToAxis: true,
              releaseOnEdges: true,
              sensitivity: 1,
            }}
            breakpoints={{
              0: { slidesOffsetBefore: 16, slidesOffsetAfter: 16 },
              769: { slidesOffsetBefore: 44, slidesOffsetAfter: 44 },
            }}
            virtual={false}>
            {posts.map((post, index) => (
              <SwiperSlide
                className="content-slider-slide"
                key={`${post.link}-${index}`}
                virtualIndex={index}>
                <PostCardItem
                  post={post}
                  focusKey={`CARD_${sanitizedTitle}_${index}_${post.link.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                  onClick={handlePostClick}
                  onRemove={onRemove}
                />
              </SwiperSlide>
            ))}
          </Swiper>

          <button
            className="slider-arrow right"
            onClick={() => handleScroll("right")}
            aria-label="Scroll right"
            tabIndex={-1}
          >
            <ChevronRight size={32} />
          </button>
        </div>
      </div>
    </FocusContext.Provider>
  );
};

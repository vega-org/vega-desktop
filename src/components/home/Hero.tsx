import React from "react";
import { LuPlay as Play } from "react-icons/lu";
import {
  isPosterLikeArtwork,
  useHeroMetadata,
  useHeroRotation,
} from "../../lib/hooks/useHomePageData";
import { prefetchArtworkPalette, useArtworkPalette } from "../../lib/hooks/useArtworkPalette";
import { useNavigate } from "react-router-dom";
import useContentStore from "../../lib/zustand/contentStore";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import { Skeleton } from "../ui/skeleton";
import type { Post } from "../../lib/providers/types";
import "./Hero.css";

interface HeroProps {
  /** Heroes to rotate through; empty shows the loading skeleton. */
  posts: Post[];
}

const usePageVisible = () => {
  const [visible, setVisible] = React.useState(
    () => document.visibilityState === "visible",
  );
  React.useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
};

export const Hero: React.FC<HeroProps> = ({ posts }) => {
  const navigate = useNavigate();
  const { provider } = useContentStore();
  const tvMode = settingsStorage.isTvModeEnabled();
  const pageVisible = usePageVisible();
  const [hovered, setHovered] = React.useState(false);
  const [playFocusedState, setPlayFocusedState] = React.useState(false);
  const {
    post,
    activeIndex,
    readyLinks,
  } = useHeroRotation(
    posts,
    provider?.value || "",
    hovered || playFocusedState || !pageVisible,
  );
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  // A dot click shows that hero until the rotation moves on.
  React.useEffect(() => setSelectedIndex(null), [activeIndex]);
  const shownPost =
    selectedIndex !== null && posts[selectedIndex] ? posts[selectedIndex] : post;

  const { data: meta, isLoading: metaLoading } = useHeroMetadata(
    shownPost?.link || "",
    provider?.value || "",
  );
  const heroArtwork = meta?.background || meta?.image || shownPost?.image;
  // Posters and small images are shown blurred with the poster beside them,
  // instead of stretched sharp across the hero.
  const [artworkSize, setArtworkSize] = React.useState<{
    url: string;
    posterLike: boolean;
  }>();
  React.useEffect(() => {
    if (!heroArtwork) return;
    const image = new window.Image();
    image.onload = () =>
      setArtworkSize({
        url: heroArtwork,
        posterLike: isPosterLikeArtwork(image.naturalWidth, image.naturalHeight),
      });
    image.onerror = () => setArtworkSize({ url: heroArtwork, posterLike: false });
    image.src = heroArtwork;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [heroArtwork]);
  const posterLike =
    artworkSize?.url === heroArtwork && artworkSize?.posterLike === true;
  const artworkPaletteStyle = useArtworkPalette(heroArtwork);
  const heroButtonStyle = {
    "--primary": "#ffffff",
    "--on-primary": "#171717",
    ...artworkPaletteStyle,
  } as React.CSSProperties;

  React.useEffect(() => {
    if (shownPost?.image && settingsStorage.isInfoPageDynamicThemeEnabled()) {
      void prefetchArtworkPalette(shownPost.image);
    }
  }, [shownPost?.image]);

  const handlePlayClick = () => {
    if (shownPost) {
      const params = new URLSearchParams();
      if (provider?.value) params.set("provider", provider.value);
      if (shownPost.image) params.set("poster", shownPost.image);
      navigate(
        `/content/${encodeURIComponent(shownPost.link)}?${params.toString()}`,
      );
    }
  };

  const { ref: playRef, focused: playFocused } = useFocusable({
    focusable: tvMode && !!shownPost,
    onEnterPress: handlePlayClick,
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  // The rotation pauses while the TV focus is on Play.
  React.useEffect(() => setPlayFocusedState(playFocused), [playFocused]);

  if (!shownPost || metaLoading) {
    return (
      <div className="hero-container skeleton">
        {shownPost ? (
          <div
            className="hero-background"
            style={{ backgroundImage: `url(${shownPost.image})` }}
          />
        ) : (
          <Skeleton className="hero-skeleton-bg" />
        )}
        <div className="hero-vignette" />
        <div className="hero-content">
          <Skeleton className="hero-skeleton-title" />
          <Skeleton className="hero-skeleton-copy hero-skeleton-copy-wide" />
          <Skeleton className="hero-skeleton-copy" />
          <Skeleton className="hero-skeleton-button" />
        </div>
      </div>
    );
  }

  // Prefer enriched artwork when requested, then provider metadata and the post.
  const bgImage = meta?.background || meta?.image || shownPost.image;
  // Use logo if available, otherwise just text
  const logoUrl = meta?.logo;
  const displayTitle = meta?.name || meta?.title || shownPost.title;
  const description = meta?.description || meta?.plot || meta?.synopsis || "";

  return (
    <div
      className="hero-container"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        key={bgImage}
        className={`hero-background hero-fade ${posterLike ? "poster-like" : ""}`}
        style={{ backgroundImage: `url(${bgImage})` }}
      />
      <div className="hero-vignette" />
      {posterLike && (
        <img
          key={`poster-${bgImage}`}
          src={bgImage}
          alt=""
          className="hero-poster hero-fade"
        />
      )}

      <div className="hero-content">
        <div key={shownPost.link} className="hero-fade">
          {logoUrl ? (
            <img src={logoUrl} alt={displayTitle} className="hero-logo" />
          ) : (
            <h1 className="hero-title display-lg">{displayTitle}</h1>
          )}

          {description && (
            <p className="hero-description body-lg">{description}</p>
          )}
        </div>

        <div className="hero-actions">
          <button
            ref={playRef}
            className={`btn-play ${playFocused ? "tv-focus" : ""}`}
            style={heroButtonStyle}
            onClick={handlePlayClick}
          >
            <Play size={18} fill="currentColor" />
            <span>Play</span>
          </button>
        </div>

        {readyLinks.length > 1 && (
          <div className="hero-dots">
            {posts.map((item, index) =>
              readyLinks.includes(item.link) ? (
                <button
                  key={item.link}
                  type="button"
                  className={`hero-dot ${item.link === shownPost.link ? "active" : ""}`}
                  aria-label={`Show ${item.title}`}
                  onClick={() => setSelectedIndex(index)}
                />
              ) : null,
            )}
          </div>
        )}
      </div>
    </div>
  );
};

import React from "react";
import { LuPlay as Play } from "react-icons/lu";
import { useHeroMetadata } from "../../lib/hooks/useHomePageData";
import { prefetchArtworkPalette, useArtworkPalette } from "../../lib/hooks/useArtworkPalette";
import { useNavigate } from "react-router-dom";
import useContentStore from "../../lib/zustand/contentStore";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import { Skeleton } from "../ui/skeleton";
import "./Hero.css";

interface HeroProps {
  post: {
    title: string;
    image: string;
    link: string;
  } | null;
}

export const Hero: React.FC<HeroProps> = ({ post }) => {
  const navigate = useNavigate();
  const { provider } = useContentStore();
  const tvMode = settingsStorage.isTvModeEnabled();

  const { data: meta, isLoading: metaLoading } = useHeroMetadata(
    post?.link || "",
    provider?.value || "",
  );
  const heroArtwork = meta?.background || meta?.image || post?.image;
  const artworkPaletteStyle = useArtworkPalette(heroArtwork);
  const heroButtonStyle = {
    "--primary": "#ffffff",
    "--on-primary": "#171717",
    ...artworkPaletteStyle,
  } as React.CSSProperties;

  React.useEffect(() => {
    if (post?.image && settingsStorage.isInfoPageDynamicThemeEnabled()) {
      void prefetchArtworkPalette(post.image);
    }
  }, [post?.image]);

  const handlePlayClick = () => {
    if (post) {
      const params = new URLSearchParams();
      if (provider?.value) params.set("provider", provider.value);
      if (post.image) params.set("poster", post.image);
      navigate(`/content/${encodeURIComponent(post.link)}?${params.toString()}`);
    }
  };

  const { ref: playRef, focused: playFocused } = useFocusable({
    focusable: tvMode && !!post,
    onEnterPress: handlePlayClick,
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  if (!post || metaLoading) {
    return (
      <div className="hero-container skeleton">
        {post ? (
          <div
            className="hero-background"
            style={{ backgroundImage: `url(${post.image})` }}
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
  const bgImage = meta?.background || meta?.image || post.image;
  // Use logo if available, otherwise just text
  const logoUrl = meta?.logo;
  const displayTitle = meta?.name || meta?.title || post.title;
  const description = meta?.description || meta?.plot || meta?.synopsis || "";

  return (
    <div className="hero-container">
      <div
        className="hero-background"
        style={{ backgroundImage: `url(${bgImage})` }}
      />
      <div className="hero-vignette" />

      <div className="hero-content">
        {logoUrl ? (
          <img src={logoUrl} alt={displayTitle} className="hero-logo" />
        ) : (
          <h1 className="hero-title display-lg">{displayTitle}</h1>
        )}

        {description && (
          <p className="hero-description body-lg">{description}</p>
        )}

        <div className="hero-actions">
          <button
            ref={playRef}
            className={`btn-play ${playFocused ? "tv-focus" : ""}`}
            style={heroButtonStyle}
            onClick={handlePlayClick}
          >
            <Play size={24} fill="currentColor" />
            <span className="label-lg">Play</span>
          </button>
        </div>
      </div>
    </div>
  );
};

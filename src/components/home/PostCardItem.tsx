import React, { useEffect, useState } from "react";
import { LuX as X } from "react-icons/lu";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import { cn } from "../../lib/utils";
import {
  prefetchArtworkPalette,
  useArtworkPalette,
} from "../../lib/hooks/useArtworkPalette";

export interface Post {
  title: string;
  image: string;
  link: string;
  progress?: number;
  providerValue?: string;
  type?: string;
  episodeTitle?: string;
  aspectRatio?: number | string;
  borderRadius?: number;
  tag?: string;
  cornerTag?: string;
}

export const parseAspectRatio = (
  ratio?: number | string,
  fallback: number = 2 / 3,
): number => {
  if (typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0) {
    return ratio;
  }
  if (typeof ratio === "string") {
    const trimmed = ratio.trim();
    if (trimmed.includes(":")) {
      const [w, h] = trimmed.split(":").map(Number);
      if (w > 0 && h > 0) return w / h;
    }
    if (trimmed.includes("/")) {
      const [w, h] = trimmed.split("/").map(Number);
      if (w > 0 && h > 0) return w / h;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
};

interface PostCardItemProps {
  post: Post;
  onClick: (post: Post) => void;
  onRemove?: (post: Post, e: React.MouseEvent) => void;
  /** Tooltip of the remove button. */
  removeLabel?: string;
  focusKey?: string;
  onFocus?: () => void;
}

export const PostCardItem: React.FC<PostCardItemProps> = ({
  post,
  onClick,
  onRemove,
  removeLabel = "Remove from history",
  focusKey: customFocusKey,
  onFocus: customOnFocus,
}) => {
  const isAndroid = navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [post.image]);

  const progressPalette = useArtworkPalette(
    post.progress !== undefined ? post.image : null,
  );
  const progressColor = progressPalette?.["--artwork-accent"];
  const prepareTheme = () => {
    if (settingsStorage.isInfoPageDynamicThemeEnabled()) {
      void prefetchArtworkPalette(post.image);
    }
  };

  const cardFocusKey = customFocusKey || `POST_CARD_${post.link.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const removeFocusKey = `${cardFocusKey}_REMOVE`;

  const {
    ref: removeRef,
    focused: removeFocused,
    focusSelf: focusRemove,
  } = useFocusable({
    focusKey: removeFocusKey,
    focusable: tvMode && Boolean(onRemove),
    onEnterPress: () => {
      if (onRemove) {
        onRemove(post, {
          stopPropagation: () => {},
          preventDefault: () => {},
        } as any);
      }
    },
    onArrowPress: (direction) => {
      if (direction === "down") {
        focusCard();
        return false;
      }
      return true;
    },
    onFocus: (layout) => {
      layout.node.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    },
  });

  const {
    ref: cardRef,
    focused: cardFocused,
    focusSelf: focusCard,
  } = useFocusable({
    focusKey: cardFocusKey,
    focusable: tvMode,
    onEnterPress: () => onClick(post),
    onArrowPress: (direction) => {
      if (direction === "up" && onRemove) {
        focusRemove();
        return false;
      }
      return true;
    },
    onFocus: (layout) => {
      prepareTheme();
      customOnFocus?.();
      layout.node.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    },
  });

  const activeAspectRatio = parseAspectRatio(post.aspectRatio, 2 / 3);
  const isLandscape = activeAspectRatio > 1.2;
  const isSquare = activeAspectRatio > 0.85 && activeAspectRatio <= 1.2;
  const activeTag = post.cornerTag || post.tag;

  return (
    <div
      ref={cardRef as any}
      className={cn(
        "post-card",
        isLandscape && "post-card-landscape",
        isSquare && "post-card-square",
        cardFocused && "tv-focus",
        removeFocused && "child-focused",
      )}
      onPointerEnter={prepareTheme}
      onClick={() => {
        prepareTheme();
        onClick(post);
      }}
      onKeyDown={(e) => {
        if (
          e.key === "Delete" ||
          e.key === "Backspace" ||
          e.key === "x" ||
          e.key === "X"
        ) {
          if (onRemove) {
            e.preventDefault();
            e.stopPropagation();
            onRemove(post, e as any);
          }
        }
      }}
      role="button"
      aria-label={`Open ${post.title}`}
      tabIndex={tvMode ? -1 : 0}
    >
      <div
        className="post-image-container"
        style={{
          aspectRatio: activeAspectRatio,
          ...(typeof post.borderRadius === "number" && post.borderRadius >= 0
            ? { borderRadius: post.borderRadius }
            : {}),
        }}
      >
        {activeTag && activeTag.trim().length > 0 && (
          <span className="post-corner-tag">
            {activeTag.trim().toUpperCase()}
          </span>
        )}
        {post.image && !imageFailed && (
          <img
            src={post.image}
            alt=""
            className="post-image"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        )}
        {onRemove && (
          <button
            ref={removeRef as any}
            type="button"
            className={cn(
              "post-remove-btn",
              removeFocused && "tv-focus focused",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(post, e);
            }}
            title={removeLabel}
            aria-label={`${removeLabel}: ${post.title}`}
            tabIndex={tvMode ? -1 : 0}
          >
            <X size={20} />
          </button>
        )}
        {post.progress !== undefined && (
          <div className="post-progress-bar-container">
            <div
              className="post-progress-bar-fill"
              style={{
                width: `${post.progress * 100}%`,
                ...(progressColor ? { backgroundColor: progressColor } : {}),
              }}
            />
          </div>
        )}
      </div>
      <div className="post-copy">
        <h3 className="post-title label-md">{post.title}</h3>
        {post.episodeTitle && (
          <p className="post-subtitle">{post.episodeTitle}</p>
        )}
      </div>
    </div>
  );
};

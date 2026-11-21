import React, { memo, useEffect, useRef, useState } from "react";
import { LuX as X } from "react-icons/lu";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { settingsStorage } from "../../lib/storage";
import { cn } from "../../lib/utils";
import { cardArtwork } from "../../lib/cardArtwork";
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

function PostRemoveButton({post, onRemove, label, cardFocusKey, tvMode, onFocusChange}: {
  post: Post;
  onRemove: NonNullable<PostCardItemProps['onRemove']>;
  label: string;
  cardFocusKey: string;
  tvMode: boolean;
  onFocusChange: (focused: boolean) => void;
}) {
  const {ref, focused} = useFocusable({
    focusKey: `${cardFocusKey}_REMOVE`,
    focusable: tvMode,
    onEnterPress: () => onRemove(post, {
      stopPropagation: () => {}, preventDefault: () => {},
    } as any),
    onArrowPress: direction => {
      if (direction === 'down') { setFocus(cardFocusKey); return false; }
      return true;
    },
    onFocus: layout => {
      onFocusChange(true);
      layout.node.scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'nearest'});
    },
    onBlur: () => onFocusChange(false),
  });
  return (
    <button ref={ref as any} type="button"
      className={cn('post-remove-btn', focused && 'tv-focus focused')}
      onClick={e => {e.stopPropagation(); onRemove(post, e);}}
      title={label} aria-label={`${label}: ${post.title}`} tabIndex={tvMode ? -1 : 0}>
      <X size={20} />
    </button>
  );
}

export const PostCardItem = memo(function PostCardItem({
  post,
  onClick,
  onRemove,
  removeLabel = "Remove from history",
  focusKey: customFocusKey,
  onFocus: customOnFocus,
}: PostCardItemProps) {
  const tvMode = settingsStorage.isTvModeEnabled();
  const [imageFailed, setImageFailed] = useState(false);
  const [containImage, setContainImage] = useState(false);
  const [removeFocused, setRemoveFocused] = useState(false);
  const paletteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(paletteTimer.current), [post.image]);

  useEffect(() => {
    setImageFailed(false);
    setContainImage(false);
  }, [post.image]);

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
    ref: cardRef,
    focused: cardFocused,
  } = useFocusable({
    focusKey: cardFocusKey,
    focusable: tvMode,
    onEnterPress: () => onClick(post),
    onArrowPress: (direction) => {
      if (direction === "up" && onRemove) {
        setFocus(removeFocusKey);
        return false;
      }
      return true;
    },
    onFocus: (layout) => {
      setRemoveFocused(false);
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
        onRemove && removeFocused && "child-focused",
      )}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(paletteTimer.current);
        paletteTimer.current = setTimeout(prepareTheme, 220);
      }}
      onPointerLeave={() => clearTimeout(paletteTimer.current)}
      onPointerDown={() => clearTimeout(paletteTimer.current)}
      onClick={() => {
        clearTimeout(paletteTimer.current);
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
            {...cardArtwork(post.image, activeAspectRatio)}
            alt=""
            className={cn("post-image", containImage && "post-image-contain")}
            loading="lazy"
            decoding="async"
            draggable={false}
            referrerPolicy="no-referrer"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (!naturalWidth || !naturalHeight) return;
              const naturalRatio = naturalWidth / naturalHeight;
              const mismatch =
                naturalRatio / activeAspectRatio > 1.35 ||
                activeAspectRatio / naturalRatio > 1.35;
              const isSmallLogo =
                Math.max(naturalWidth, naturalHeight) < 320 && naturalRatio > 1.05;
              setContainImage(mismatch || isSmallLogo);
            }}
            onError={() => setImageFailed(true)}
          />
        )}
        {onRemove && (
          <PostRemoveButton post={post} onRemove={onRemove} label={removeLabel}
            cardFocusKey={cardFocusKey} tvMode={tvMode} onFocusChange={setRemoveFocused} />
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
});

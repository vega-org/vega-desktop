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
}

interface PostCardItemProps {
  post: Post;
  onClick: (post: Post) => void;
  onRemove?: (post: Post, e: React.MouseEvent) => void;
  focusKey?: string;
  onFocus?: () => void;
}

export const PostCardItem: React.FC<PostCardItemProps> = ({
  post,
  onClick,
  onRemove,
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
  const progressColor = progressPalette["--artwork-accent"];
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

  return (
    <div
      ref={cardRef as any}
      className={cn(
        "post-card",
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
      <div className="post-image-container">
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
            title="Remove from history"
            aria-label={`Remove ${post.title} from history`}
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

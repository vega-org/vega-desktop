import React from "react";
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
}

export const PostCardItem: React.FC<PostCardItemProps> = ({
  post,
  onClick,
  onRemove,
}) => {
  const tvMode = settingsStorage.isTvModeEnabled();
  const progressPalette = useArtworkPalette(
    post.progress !== undefined ? post.image : null,
  );
  const progressColor = progressPalette["--artwork-accent"];
  const prepareTheme = () => {
    if (settingsStorage.isInfoPageDynamicThemeEnabled()) {
      void prefetchArtworkPalette(post.image);
    }
  };

  const { ref, focused } = useFocusable({
    focusable: tvMode,
    onEnterPress: () => onClick(post),
    onFocus: (layout) => {
      prepareTheme();
      layout.node.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    },
  });

  return (
    <div
      ref={ref}
      className={cn("post-card", focused && "tv-focus")}
      onPointerEnter={prepareTheme}
      onClick={() => {
        prepareTheme();
        onClick(post);
      }}
      role="button"
      aria-label={`Open ${post.title}`}
    >
      <div className="post-image-container">
        <img
          src={post.image}
          alt={post.title}
          className="post-image"
          loading="lazy"
        />
        {onRemove && (
          <button
            className="post-remove-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(post, e);
            }}
            title="Remove from history"
            aria-label={`Remove ${post.title} from history`}
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

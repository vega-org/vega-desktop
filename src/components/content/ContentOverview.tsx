import React, { useEffect, useState } from "react";
import {
  LuBookmark as Bookmark,
  LuBookmarkCheck as BookmarkCheck,
  LuBookOpen as BookOpen,
  LuClapperboard as Clapperboard,
  LuGlobe as Globe,
  LuSearch as Search,
} from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";

interface ContentOverviewProps {
  description?: string;
  providerName?: string;
  isSaved: boolean;
  onSearch: () => void;
  onToggleSaved: () => void;
  onOpenWeb?: () => void;
  onOpenStory?: () => void;
  onOpenTrailer?: () => void;
}

export const ContentOverview: React.FC<ContentOverviewProps> = ({
  description,
  providerName,
  isSaved,
  onSearch,
  onToggleSaved,
  onOpenWeb,
  onOpenStory,
  onOpenTrailer,
}) => {
  const [readMore, setReadMore] = useState(false);
  const synopsis = description || "No synopsis is available for this title.";
  const synopsisText = synopsis.length > 240 && !readMore
    ? `${synopsis.slice(0, 240)}...`
    : synopsis;

  useEffect(() => setReadMore(false), [description]);

  return (
    <section
      className="content-overview"
      aria-labelledby="content-overview-title"
    >
      <div className="content-synopsis-heading">
        <h2 id="content-overview-title">Synopsis</h2>
        {providerName && <span>{providerName}</span>}
      </div>
      <p className="content-synopsis">
        {synopsisText}
      </p>
      {synopsis.length > 240 && (
        <FocusableButton className="content-read-more" onClick={() => setReadMore((value) => !value)}>
          {readMore ? "Show less" : "Read more"}
        </FocusableButton>
      )}

      <div className="content-info-actions" aria-label="Title actions">
        <FocusableButton className="content-info-action" onClick={onSearch} focusKey="CONTENT_SEARCH">
          <Search size={27} />
          <span>Search</span>
        </FocusableButton>
        {onOpenWeb && (
          <FocusableButton className="content-info-action" onClick={onOpenWeb} focusKey="CONTENT_WEB">
            <Globe size={27} />
            <span>Web</span>
          </FocusableButton>
        )}
        {onOpenStory ? (
          <FocusableButton className="content-info-action" onClick={onOpenStory} focusKey="CONTENT_STORY">
            <BookOpen size={27} />
            <span>Explore</span>
          </FocusableButton>
        ) : onOpenTrailer ? (
          <FocusableButton className="content-info-action" onClick={onOpenTrailer} focusKey="CONTENT_TRAILER">
            <Clapperboard size={27} />
            <span>Trailer</span>
          </FocusableButton>
        ) : null}
        <FocusableButton
          className={`content-info-action ${isSaved ? "active" : ""}`}
          onClick={onToggleSaved}
          focusKey="CONTENT_WATCHLIST"
        >
          {isSaved ? <BookmarkCheck size={27} /> : <Bookmark size={27} />}
          <span>{isSaved ? "In watchlist" : "Watchlist"}</span>
        </FocusableButton>
      </div>
    </section>
  );
};

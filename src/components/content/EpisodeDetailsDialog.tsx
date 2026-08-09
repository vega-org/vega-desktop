import React, { useEffect, useState } from "react";
import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { LuImageOff, LuX } from "react-icons/lu";
import { settingsStorage } from "../../lib/storage";
import { FocusableButton } from "../layout/FocusableButton";

export interface EpisodeDetails {
  title: string;
  description: string;
  image?: string;
}

interface EpisodeDetailsDialogProps {
  details: EpisodeDetails | null;
  onClose: () => void;
}

const getImageUrl = (image?: string) => {
  const value = image?.trim();
  return value && /^https?:\/\//i.test(value) ? value : undefined;
};

export const EpisodeDetailsDialog: React.FC<EpisodeDetailsDialogProps> = ({
  details,
  onClose,
}) => {
  const [imageFailed, setImageFailed] = useState(false);
  const image = getImageUrl(details?.image);
  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref, focusKey, focusSelf } = useFocusable({
    focusable: tvMode && Boolean(details),
    trackChildren: true,
    isFocusBoundary: true,
  });

  useEffect(() => setImageFailed(false), [image]);

  useEffect(() => {
    if (!details || !tvMode) return;
    const timer = window.setTimeout(() => focusSelf(), 50);
    return () => window.clearTimeout(timer);
  }, [details, focusSelf, tvMode]);

  useEffect(() => {
    if (!details) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [details, onClose]);

  if (!details) return null;

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        className="episode-details-overlay"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) onClose();
        }}
      >
        <section
          ref={ref as React.Ref<HTMLElement>}
          className="episode-details-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="episode-details-title"
        >
          <FocusableButton
            className="episode-details-close"
            focusKey="EPISODE_DETAILS_CLOSE"
            onClick={onClose}
            aria-label="Close episode details"
          >
            <LuX size={24} />
          </FocusableButton>

          <div className="episode-details-media">
            {image && !imageFailed ? (
              <img src={image} alt="" onError={() => setImageFailed(true)} />
            ) : (
              <span><LuImageOff size={44} /></span>
            )}
          </div>

          <div className="episode-details-copy">
            <h2 id="episode-details-title">{details.title}</h2>
            <p>{details.description}</p>
          </div>
        </section>
      </div>
    </FocusContext.Provider>
  );
};

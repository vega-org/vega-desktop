import React, { useEffect, useState } from "react";
import {
  LuDownload as Download,
  LuListEnd as Queued,
  LuLoaderCircle as Loader,
  LuPause as Pause,
  LuRotateCcw as Retry,
  LuTrash2 as Trash2,
} from "react-icons/lu";
import { IoPlayCircle } from "react-icons/io5";
import type { DownloadItem } from "../../lib/zustand/downloadStore";
import { FocusableButton } from "../layout/FocusableButton";

const DOWNLOAD_PROGRESS_SIZE = 36;
const DOWNLOAD_PROGRESS_CENTER = DOWNLOAD_PROGRESS_SIZE / 2;
const DOWNLOAD_PROGRESS_RADIUS = 15;

const createProgressPiePath = (progress: number) => {
  if (progress <= 0 || progress >= 1) return undefined;
  const endAngle = progress * Math.PI * 2 - Math.PI / 2;
  const endX = DOWNLOAD_PROGRESS_CENTER + DOWNLOAD_PROGRESS_RADIUS * Math.cos(endAngle);
  const endY = DOWNLOAD_PROGRESS_CENTER + DOWNLOAD_PROGRESS_RADIUS * Math.sin(endAngle);
  const largeArcFlag = progress > 0.5 ? 1 : 0;

  return [
    `M ${DOWNLOAD_PROGRESS_CENTER} ${DOWNLOAD_PROGRESS_CENTER}`,
    `L ${DOWNLOAD_PROGRESS_CENTER} ${DOWNLOAD_PROGRESS_CENTER - DOWNLOAD_PROGRESS_RADIUS}`,
    `A ${DOWNLOAD_PROGRESS_RADIUS} ${DOWNLOAD_PROGRESS_RADIUS} 0 ${largeArcFlag} 1 ${endX} ${endY}`,
    "Z",
  ].join(" ");
};

const DownloadProgressPie: React.FC<{ progress: number; hasKnownTotal: boolean }> = ({
  progress,
  hasKnownTotal,
}) => {
  const normalizedProgress = Math.min(1, Math.max(0, progress / 100));
  const progressPath = createProgressPiePath(normalizedProgress);

  return (
    <span className="episode-download-progress" aria-hidden="true">
      <svg viewBox={`0 0 ${DOWNLOAD_PROGRESS_SIZE} ${DOWNLOAD_PROGRESS_SIZE}`}>
        <circle
          className="episode-download-progress-track"
          cx={DOWNLOAD_PROGRESS_CENTER}
          cy={DOWNLOAD_PROGRESS_CENTER}
          r={DOWNLOAD_PROGRESS_RADIUS}
        />
        {normalizedProgress >= 1 ? (
          <circle
            className="episode-download-progress-value"
            cx={DOWNLOAD_PROGRESS_CENTER}
            cy={DOWNLOAD_PROGRESS_CENTER}
            r={DOWNLOAD_PROGRESS_RADIUS}
          />
        ) : progressPath ? (
          <path className="episode-download-progress-value" d={progressPath} />
        ) : null}
      </svg>
      {!hasKnownTotal && <Download size={17} />}
    </span>
  );
};

interface EpisodeRowProps {
  index: number;
  title: string;
  description?: string;
  image?: string;
  progressPercent: number;
  watched: boolean;
  download?: DownloadItem;
  extracting: boolean;
  onPlay: () => void;
  onDownload: () => void;
  onDeleteDownload: () => void;
}

const EpisodeMedia: React.FC<{ image?: string }> = ({ image }) => {
  const source = image?.trim() && /^https?:\/\//i.test(image) ? image : undefined;
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [source]);

  return (
    <span className={`episode-media ${source && !failed ? "has-image" : ""}`}>
      {source && !failed ? (
        <img src={source} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <IoPlayCircle size={32} />
      )}
    </span>
  );
};

export const EpisodeRow: React.FC<EpisodeRowProps> = ({
  index,
  title,
  description,
  image,
  progressPercent,
  watched,
  download,
  extracting,
  onPlay,
  onDownload,
  onDeleteDownload,
}) => {
  const episodeDescription = description?.trim();
  const progress =
    download?.status === "downloading" && download.totalBytes
      ? Math.min((download.downloadedBytes / download.totalBytes) * 100, 100)
      : progressPercent;

  return (
    <article className={`content-episode-row ${watched ? "watched" : ""}`}>
      <FocusableButton
        className="episode-play-area"
        onClick={onPlay}
        focusKey={`EPISODE_PLAY_${index}`}
      >
        <EpisodeMedia image={image} />
        <span className="episode-copy">
          <strong>{title}</strong>
          {episodeDescription && (
            <small title={episodeDescription}>{episodeDescription}</small>
          )}
        </span>
      </FocusableButton>

      <div className="content-episode-download">
        {extracting ? (
          <span
            className="episode-action-static"
            title="Finding download servers"
          >
            <Loader size={19} className="spin" />
          </span>
        ) : download?.status === "completed" ? (
          <FocusableButton
            className="episode-action-button"
            onClick={onDeleteDownload}
            title="Delete download"
          >
            <Trash2 size={18} />
          </FocusableButton>
        ) : download?.status === "downloading" ? (
          <span
            className="episode-action-static"
            title={download.totalBytes ? `Download ${Math.round(progress)}%` : "Downloading"}
          >
            <DownloadProgressPie
              progress={progress}
              hasKnownTotal={download.totalBytes > 0}
            />
          </span>
        ) : download?.status === "queued" ? (
          <span className="episode-action-static queued" title="Queued for download">
            <Queued size={20} />
          </span>
        ) : download?.status === "paused" ? (
          <span className="episode-action-static paused" title="Download paused">
            <Pause size={20} />
          </span>
        ) : download?.status === "error" ? (
          <FocusableButton
            className="episode-action-button error"
            onClick={onDownload}
            title="Retry download"
          >
            <Retry size={18} />
          </FocusableButton>
        ) : (
          <FocusableButton
            className="episode-action-button"
            onClick={onDownload}
            title="Download"
          >
            <Download size={18} />
          </FocusableButton>
        )}
      </div>

    </article>
  );
};

import React from "react";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import { useControlsFocus } from "../../lib/context/ControlsFocusContext";
import type { MpvChapter } from "../../lib/player/PlayerEngine";
import type { SkipInterval } from "../../lib/providers/types";

interface TimelineScrubberProps {
  isLive?: boolean;
  duration: number;
  renderedTime: number;
  progressPercent: number;
  cachePercent: number;
  formatTime: (timeInSeconds: number) => string;
  onSeekRelative: (offset: number) => void;
  onScrubbingChange?: (scrubbing: boolean) => void;
  chapters?: MpvChapter[];
  skips?: SkipInterval[];
  timelinePreview: { time: number; percent: number; bucket?: number; image?: string | null } | null;
  setTimelinePreview: React.Dispatch<React.SetStateAction<{ time: number; percent: number; bucket: number; image: string | null } | null>>;
  updateTimelinePreview: (e: MouseEvent | React.MouseEvent) => number | null;
  draggingTimelineRef: React.MutableRefObject<boolean>;
  trackRef: React.RefObject<HTMLDivElement | null>;
  handleTrackPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  focusable?: boolean;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  isLive = false,
  duration,
  renderedTime,
  progressPercent,
  cachePercent,
  formatTime,
  onSeekRelative,
  onScrubbingChange,
  chapters = [],
  skips = [],
  timelinePreview,
  setTimelinePreview,
  updateTimelinePreview,
  draggingTimelineRef,
  trackRef,
  handleTrackPointerDown,
  focusable,
}) => {
  const tvMode = settingsStorage.isTvModeEnabled();
  const isControlsVisible = useControlsFocus();
  const canFocus =
    (focusable !== undefined ? focusable : true) && tvMode && isControlsVisible;

  const { ref: focusRef, focused } = useFocusable({
    focusKey: "PLAYER_TIMELINE",
    focusable: canFocus,
    onArrowPress: (direction) => {
      if (direction === "left") {
        onSeekRelative(-10);
        return false;
      }
      if (direction === "right") {
        onSeekRelative(10);
        return false;
      }
      return true; // Allow up/down to navigate to center controls / bottom row
    },
  });

  const canSeek = !isLive && duration > 0;
  const clampedProgress = Math.min(100, Math.max(0, progressPercent));
  const clampedCache = Math.min(100, Math.max(0, cachePercent));
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      ref={focusRef}
      className={`player-timeline ${isLive ? "is-live" : ""} ${focused && canFocus ? "tv-focus" : ""}`}
      onClick={stop}
      onDoubleClick={stop}
    >
      {!isLive && <span className="timeline-time">{formatTime(renderedTime)}</span>}
      <div
        ref={trackRef}
        className="timeline-track"
        onPointerDown={canSeek ? handleTrackPointerDown : undefined}
        style={{
          touchAction: "none",
          opacity: canSeek ? 1 : 0.35,
          pointerEvents: canSeek ? "auto" : "none",
          cursor: canSeek ? "pointer" : "default",
        }}
        onMouseEnter={canSeek ? (event) => {
          onScrubbingChange?.(true);
          updateTimelinePreview(event);
        } : undefined}
        onMouseMove={canSeek ? (event) => {
          if (!draggingTimelineRef.current) onScrubbingChange?.(true);
          updateTimelinePreview(event);
        } : undefined}
        onMouseLeave={canSeek ? () => {
          if (!draggingTimelineRef.current) {
            setTimelinePreview(null);
            onScrubbingChange?.(false);
          }
        } : undefined}
      >
        {canSeek && timelinePreview && (
          <div
            className={`timeline-preview ${timelinePreview.image ? "ready" : ""}`}
            style={{
              left: `${timelinePreview.percent}%`,
              transform:
                timelinePreview.percent < 10
                  ? "translateX(0)"
                  : timelinePreview.percent > 90
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
          >
            <div className="timeline-preview-frame">
              {timelinePreview.image ? (
                <img src={timelinePreview.image} alt="" draggable={false} />
              ) : (
                <div className="timeline-preview-skeleton" />
              )}
            </div>
            <span>{formatTime(timelinePreview.time)}</span>
          </div>
        )}
        <div
          className="timeline-cache"
          style={{
            width: `${clampedCache}%`,
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            backgroundColor: "rgba(255, 255, 255, 0.3)",
            borderRadius: "2px",
            pointerEvents: "none",
          }}
        />
        <div
          className="timeline-progress"
          style={{ width: `${clampedProgress}%` }}
        >
          {canSeek && <div className="timeline-thumb" />}
        </div>
        {canSeek &&
          chapters.slice(1).map((chapter, index) => (
            <span
              key={`${chapter.time}-${index}`}
              className="timeline-chapter-gap"
              style={{
                left: `${Math.min(100, Math.max(0, (chapter.time / duration) * 100))}%`,
              }}
              title={`${chapter.title} · ${formatTime(chapter.time)}`}
              aria-hidden="true"
            />
          ))}
        {canSeek &&
          skips.map((skip, index) => {
            const gaps = [];
            if (skip.from > 0 && skip.from < duration) {
              gaps.push(
                <span
                  key={`skip-from-${index}-${skip.from}`}
                  className="timeline-skip-gap"
                  style={{
                    left: `${Math.min(100, Math.max(0, (skip.from / duration) * 100))}%`,
                  }}
                  title={`${skip.title || "Skip"} Start · ${formatTime(skip.from)}`}
                  aria-hidden="true"
                />,
              );
            }
            if (skip.to > 0 && skip.to < duration) {
              gaps.push(
                <span
                  key={`skip-to-${index}-${skip.to}`}
                  className="timeline-skip-gap"
                  style={{
                    left: `${Math.min(100, Math.max(0, (skip.to / duration) * 100))}%`,
                  }}
                  title={`${skip.title || "Skip"} End · ${formatTime(skip.to)}`}
                  aria-hidden="true"
                />,
              );
            }
            return gaps;
          })}
      </div>
      {!isLive && <span className="timeline-time right">{formatTime(duration)}</span>}
    </div>
  );
};

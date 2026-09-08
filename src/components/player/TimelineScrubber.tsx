import React from "react";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import { useControlsFocus } from "../../lib/context/ControlsFocusContext";
import type { MpvChapter } from "../../lib/hooks/useMpvPlayer";
import type { SkipInterval } from "../../lib/providers/types";

interface TimelineScrubberProps {
  duration: number;
  currentTime: number;
  pendingSeekTime: number | null;
  renderedTime: number;
  progressPercent: number;
  cachePercent: number;
  formatTime: (timeInSeconds: number) => string;
  onSeek: (time: number) => void;
  onScrubbingChange?: (scrubbing: boolean) => void;
  chapters?: MpvChapter[];
  skips?: SkipInterval[];
  timelinePreview: { time: number; percent: number; bucket?: number; image?: string | null } | null;
  setTimelinePreview: React.Dispatch<React.SetStateAction<{ time: number; percent: number; bucket: number; image: string | null } | null>>;
  updateTimelinePreview: (e: MouseEvent | React.MouseEvent) => number | null;
  draggingTimelineRef: React.MutableRefObject<boolean>;
  trackRef: React.RefObject<HTMLDivElement | null>;
  handleTrackMouseDown: (e: React.MouseEvent) => void;
  focusable?: boolean;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  duration,
  currentTime,
  pendingSeekTime,
  renderedTime,
  progressPercent,
  cachePercent,
  formatTime,
  onSeek,
  onScrubbingChange,
  chapters = [],
  skips = [],
  timelinePreview,
  setTimelinePreview,
  updateTimelinePreview,
  draggingTimelineRef,
  trackRef,
  handleTrackMouseDown,
  focusable,
}) => {
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;
  const isControlsVisible = useControlsFocus();
  const canFocus =
    (focusable !== undefined ? focusable : true) && tvMode && isControlsVisible;

  const { ref: focusRef, focused } = useFocusable({
    focusKey: "PLAYER_TIMELINE",
    focusable: canFocus,
    onArrowPress: (direction) => {
      if (direction === "left") {
        const target = Math.max(0, (pendingSeekTime ?? currentTime) - 10);
        onSeek(target);
        return false;
      }
      if (direction === "right") {
        const target = Math.min(duration || currentTime + 10, (pendingSeekTime ?? currentTime) + 10);
        onSeek(target);
        return false;
      }
      return true; // Allow up/down to navigate to center controls / bottom row
    },
  });

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      ref={focusRef}
      className={`player-timeline ${focused && canFocus ? "tv-focus" : ""}`}
      onClick={stop}
      onDoubleClick={stop}
    >
      <span className="timeline-time">{formatTime(renderedTime)}</span>
      <div
        ref={trackRef}
        className="timeline-track"
        onMouseDown={handleTrackMouseDown}
        onMouseEnter={(event) => {
          onScrubbingChange?.(true);
          updateTimelinePreview(event);
        }}
        onMouseMove={(event) => {
          if (!draggingTimelineRef.current) onScrubbingChange?.(true);
          updateTimelinePreview(event);
        }}
        onMouseLeave={() => {
          if (!draggingTimelineRef.current) {
            setTimelinePreview(null);
            onScrubbingChange?.(false);
          }
        }}
      >
        {timelinePreview && (
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
            width: `${cachePercent}%`,
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
          style={{ width: `${progressPercent}%` }}
        >
          <div className="timeline-thumb" />
        </div>
        {duration > 0 &&
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
        {duration > 0 &&
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
      <span className="timeline-time right">{formatTime(duration)}</span>
    </div>
  );
};

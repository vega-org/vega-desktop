import React, { useCallback, useRef, useState, useEffect } from "react";
import {
  LuArrowLeft as ArrowLeft,
  LuPlay as Play,
  LuPause as Pause,
  LuMaximize as Maximize,
  LuMinimize as Minimize,
  LuSkipForward as NextIcon,
  LuCaptions as Subtitles,
  LuGauge as Gauge,
  LuPictureInPicture as PictureInPicture,
  LuRectangleHorizontal as RectangleHorizontal,
  LuCheck as Check,
  LuServer as ServerIcon,
  LuTv as Tv,
  LuAudioLines,
  LuList as ChaptersIcon,
  LuKeyboard as Keyboard,
  LuX as X,
  LuEllipsisVertical as MoreVertical,
  LuExternalLink as ExternalLink,
  LuCopy as Copy,
  LuZoomIn as ZoomIn,
  LuPlus as Plus,
  LuMinus as Minus,
} from "react-icons/lu";
import {
  MdVideoSettings,
  Md4K,
  Md8K,
  MdHd,
  MdSd,
  MdHighQuality,
  MdReplay10,
  MdForward10,
} from "react-icons/md";
import type { MpvChapter, MpvTrack } from "../lib/hooks/useMpvPlayer";
import { SearchSubtitlesModal } from "../components/SearchSubtitlesModal";
import { settingsStorage } from "../lib/storage";

interface PlayerControlsProps {
  visible: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  cacheDuration?: number;
  primaryTitle: string;
  secondaryTitle?: string;
  nextEpisodeTitle?: string;
  showNextEpisode: boolean;
  onBack: () => void;
  onTogglePause: () => void;
  onSeek: (time: number) => void;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
  hasNextEpisode?: boolean;
  hasPrevEpisode?: boolean;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  onClickBackground: () => void;
  audioTracks: MpvTrack[];
  subtitleTracks: MpvTrack[];
  videoTracks?: MpvTrack[];
  chapters?: MpvChapter[];
  videoHeight?: number;
  playbackRate: number;
  streamData?: any;
  selectedStream?: any;
  onSelectStream?: (stream: any) => void;
  onSelectAudioTrack: (id: number | "no" | "auto") => void;
  onSelectSubtitleTrack: (id: number | "no" | "auto") => void;
  onSelectVideoTrack: (id: number | "no" | "auto") => void;
  onAddSubtitleFile?: (path: string) => void;
  onPlaybackRateChange: (rate: number) => void;
  onTogglePip: () => void;
  isPip: boolean;
  onToggleCrop: () => void;
  isCropped: boolean;
  zoomLevel?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  onSetZoom?: (zoom: number) => void;
  onPlayNative?: () => void;
  onOpenVlc?: () => void;
  onCopyLink?: () => void;
  showShortcuts?: boolean;
  onToggleShortcuts?: () => void;
  onRequestThumbnail?: (time: number) => Promise<string | null>;
  thumbnailKey?: string;
  onScrubbingChange?: (scrubbing: boolean) => void;
  isTV?: boolean;
}

function getQualityInfo(h: number, fallbackStr: string) {
  if (h) {
    if (h >= 3000) return { text: "8K", Icon: Md8K };
    if (h >= 1500) return { text: "4K", Icon: Md4K };
    if (h >= 1200) return { text: "1440p", Icon: MdHighQuality };
    if (h >= 780) return { text: "1080p", Icon: MdHd };
    if (h >= 500) return { text: "720p", Icon: MdHd };
    if (h >= 400) return { text: "480p", Icon: MdSd };
    if (h >= 300) return { text: "360p", Icon: MdSd };
    return { text: `${Math.round(h)}p`, Icon: MdSd };
  }

  if (fallbackStr) {
    const s = fallbackStr.toLowerCase();
    if (s.includes("8k") || s.includes("4320"))
      return { text: fallbackStr, Icon: Md8K };
    if (s.includes("4k") || s.includes("2160"))
      return { text: fallbackStr, Icon: Md4K };
    if (s.includes("1440")) return { text: fallbackStr, Icon: MdHighQuality };
    if (s.includes("1080") || s.includes("720") || s.includes("hd"))
      return { text: fallbackStr, Icon: MdHd };
    if (s.includes("480") || s.includes("360") || s.includes("sd"))
      return { text: fallbackStr, Icon: MdSd };
  }

  return { text: fallbackStr || "Auto", Icon: MdVideoSettings };
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function stop(e: React.MouseEvent) {
  e.stopPropagation();
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  visible,
  isPaused,
  isBuffering,
  currentTime,
  duration,
  cacheDuration,
  primaryTitle,
  secondaryTitle,
  nextEpisodeTitle,
  showNextEpisode,
  onBack,
  onTogglePause,
  onSeek,
  onNextEpisode,
  onToggleFullscreen,
  isFullscreen,
  onClickBackground,
  audioTracks,
  subtitleTracks,
  videoTracks = [],
  chapters = [],
  videoHeight = 0,
  playbackRate,
  streamData,
  selectedStream,
  onSelectStream,
  onSelectAudioTrack,
  onSelectSubtitleTrack,
  onSelectVideoTrack,
  onAddSubtitleFile,
  onPlaybackRateChange,
  onTogglePip,
  isPip,
  onToggleCrop,
  isCropped,
  zoomLevel = 100,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onSetZoom,
  onPlayNative,
  onOpenVlc,
  onCopyLink,
  showShortcuts = false,
  onToggleShortcuts,
  onRequestThumbnail,
  thumbnailKey,
  onScrubbingChange,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewRequestRef = useRef(0);
  const pendingPreviewBucketRef = useRef<number | null>(null);
  const queuedPreviewBucketRef = useRef<number | null>(null);
  const draggingTimelineRef = useRef(false);
  const thumbnailCacheRef = useRef(new Map<number, string | null>());
  const [timelinePreview, setTimelinePreview] = useState<{
    time: number;
    percent: number;
    bucket: number;
    image: string | null;
  } | null>(null);
  const [openMenu, setOpenMenu] = useState<
    | "audio"
    | "subtitle"
    | "speed"
    | "quality"
    | "server"
    | "chapters"
    | "more"
    | null
  >(null);
  const [showOnlineSearch, setShowOnlineSearch] = useState(false);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [customZoomInput, setCustomZoomInput] = useState(String(zoomLevel));
  const zoomInputRef = useRef<HTMLInputElement>(null);
  const showSeekButtons = !settingsStorage.hideSeekButtons();

  useEffect(() => {
    if (!isEditingZoom) {
      setCustomZoomInput(String(zoomLevel));
    }
  }, [zoomLevel, isEditingZoom]);

  useEffect(() => {
    if (isEditingZoom && zoomInputRef.current) {
      zoomInputRef.current.focus();
      zoomInputRef.current.select();
    }
  }, [isEditingZoom]);

  useEffect(() => {
    if (openMenu !== "more") {
      setIsEditingZoom(false);
    }
  }, [openMenu]);

  const handleSaveCustomZoom = useCallback(() => {
    const parsed = parseInt(customZoomInput, 10);
    if (!isNaN(parsed) && parsed > 0) {
      const clamped = Math.min(300, Math.max(50, parsed));
      onSetZoom?.(clamped);
      setCustomZoomInput(String(clamped));
    } else {
      setCustomZoomInput(String(zoomLevel));
    }
    setIsEditingZoom(false);
  }, [customZoomInput, zoomLevel, onSetZoom]);

  useEffect(() => {
    thumbnailCacheRef.current.clear();
    pendingPreviewBucketRef.current = null;
    queuedPreviewBucketRef.current = null;
    previewRequestRef.current += 1;
    setTimelinePreview(null);
  }, [thumbnailKey]);

  useEffect(
    () => () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewRequestRef.current += 1;
    },
    [],
  );

  // Close menus when clicking outside
  useEffect(() => {
    const handleDocClick = () => setOpenMenu(null);
    if (openMenu) document.addEventListener("click", handleDocClick);
    return () => document.removeEventListener("click", handleDocClick);
  }, [openMenu]);

  const toggleMenu = (
    e: React.MouseEvent,
    menu:
      | "audio"
      | "subtitle"
      | "speed"
      | "quality"
      | "server"
      | "chapters"
      | "more",
  ) => {
    e.stopPropagation();
    setOpenMenu(openMenu === menu ? null : menu);
  };

  const handleLoadLocalSubtitle = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Subtitles",
            extensions: ["srt", "vtt", "ass", "ssa", "sub"],
          },
        ],
      });
      if (selected && typeof selected === "string") {
        onAddSubtitleFile?.(selected);
        setOpenMenu(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const renderedTime =
    draggingTimelineRef.current && timelinePreview
      ? timelinePreview.time
      : currentTime;
  const progressPercent = duration > 0 ? (renderedTime / duration) * 100 : 0;
  const cachePercent =
    duration > 0
      ? Math.min(((currentTime + (cacheDuration || 0)) / duration) * 100, 100)
      : 0;
  let activeChapterIndex = -1;
  for (let index = 0; index < chapters.length; index++) {
    if (chapters[index].time <= currentTime + 0.25) activeChapterIndex = index;
    else break;
  }
  const activeChapter = chapters[activeChapterIndex];

  const updateTimelinePreview = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!trackRef.current || !duration) return null;
      const rect = trackRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const time = (x / rect.width) * duration;
      const percent = rect.width > 0 ? (x / rect.width) * 100 : 0;
      const bucketSize = duration >= 7200 ? 15 : duration >= 1800 ? 10 : 5;
      const bucket = Math.min(
        duration,
        Math.max(0, Math.round(time / bucketSize) * bucketSize),
      );
      const cached = thumbnailCacheRef.current.get(bucket);
      setTimelinePreview((current) => ({
        time,
        percent,
        bucket,
        image:
          cached !== undefined
            ? cached
            : current?.bucket === bucket
              ? current.image
              : null,
      }));

      if (
        onRequestThumbnail &&
        cached === undefined &&
        pendingPreviewBucketRef.current !== bucket
      ) {
        if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
        previewTimerRef.current = window.setTimeout(() => {
          const generation = previewRequestRef.current;
          const runRequest = async (targetBucket: number): Promise<void> => {
            if (pendingPreviewBucketRef.current !== null) {
              queuedPreviewBucketRef.current = targetBucket;
              return;
            }
            pendingPreviewBucketRef.current = targetBucket;
            const image = await onRequestThumbnail(targetBucket);
            if (generation !== previewRequestRef.current) return;
            pendingPreviewBucketRef.current = null;
            thumbnailCacheRef.current.set(targetBucket, image);
            setTimelinePreview((current) =>
              current?.bucket === targetBucket
                ? { ...current, image }
                : current,
            );

            const queuedBucket = queuedPreviewBucketRef.current;
            queuedPreviewBucketRef.current = null;
            if (
              queuedBucket !== null &&
              !thumbnailCacheRef.current.has(queuedBucket)
            ) {
              await runRequest(queuedBucket);
            }
          };
          void runRequest(bucket);
        }, 140);
      }
      return time;
    },
    [duration, onRequestThumbnail],
  );

  const handleTrackMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      draggingTimelineRef.current = true;
      onScrubbingChange?.(true);
      updateTimelinePreview(e);
      const onMove = (ev: MouseEvent) => updateTimelinePreview(ev);
      const onUp = (ev: MouseEvent) => {
        const seekTime = updateTimelinePreview(ev);
        if (seekTime !== null) onSeek(seekTime);
        draggingTimelineRef.current = false;
        onScrubbingChange?.(false);
        setTimelinePreview(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [onScrubbingChange, onSeek, updateTimelinePreview],
  );

  if (isPip) {
    const handleDrag = async (e: React.MouseEvent) => {
      if (e.button === 0) {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          getCurrentWindow().startDragging();
        } catch (err) {}
      }
    };

    return (
      <>
        <div
          style={{ position: "absolute", inset: 0, zIndex: 10, cursor: "grab" }}
          onMouseDown={handleDrag}
          onDoubleClick={onTogglePip}
        />
        <div
          className={`player-pip-overlay ${visible ? "visible" : ""}`}
          onMouseDown={handleDrag}
          onDoubleClick={onTogglePip}
        >
          <div className="player-pip-controls">
            {!isBuffering ? (
              <button
                className="center-btn play-pause"
                onClick={onTogglePause}
                onMouseDown={stop}
              >
                {isPaused ? (
                  <Play size={32} fill="#fff" />
                ) : (
                  <Pause size={32} />
                )}
              </button>
            ) : (
              <div
                className="center-btn play-pause"
                style={{ cursor: "default" }}
                onMouseDown={stop}
              >
                <div
                  className="loading-spinner"
                  style={{ width: 28, height: 28, borderWidth: 2 }}
                />
              </div>
            )}
          </div>
          <button
            className="pip-exit-btn"
            onClick={onTogglePip}
            onMouseDown={stop}
          >
            <Minimize size={16} />
          </button>
        </div>
      </>
    );
  }

  return (
    <div
      className={`player-controls-wrapper ${visible ? "visible" : ""}`}
      onClick={onClickBackground}
      onDoubleClick={onToggleFullscreen}
    >
      <div className="controls-gradient-top" />
      <div className="controls-gradient-bottom" />

      {/* Top bar */}
      <div className="player-top-bar">
        <button className="player-back-btn" onClick={onBack}>
          <ArrowLeft size={22} />
        </button>
        <div className="player-title-group">
          <span className="player-primary-title">{primaryTitle}</span>
          {secondaryTitle && (
            <span className="player-secondary-title">{secondaryTitle}</span>
          )}
        </div>
      </div>

      {/* Center playback controls */}
      <div
        className="player-center-controls"
        onClick={stop}
        onDoubleClick={stop}
      >
        {showSeekButtons ? (
          <button
            className="center-btn"
            onClick={() => onSeek(Math.max(0, currentTime - 10))}
            title="Rewind 10 seconds"
            aria-label="Rewind 10 seconds"
          >
            <MdReplay10 size={28} />
          </button>
        ) : (
          <div style={{ width: 44 }} />
        )}

        {!isBuffering ? (
          <button className="center-btn play-pause" onClick={onTogglePause}>
            {isPaused ? <Play size={32} fill="#fff" /> : <Pause size={32} />}
          </button>
        ) : (
          <div className="center-btn play-pause" style={{ cursor: "default" }}>
            <div
              className="loading-spinner"
              style={{ width: 28, height: 28, borderWidth: 2 }}
            />
          </div>
        )}

        {showSeekButtons ? (
          <button
            className="center-btn"
            onClick={() => onSeek(Math.min(duration, currentTime + 10))}
            title="Forward 10 seconds"
            aria-label="Forward 10 seconds"
          >
            <MdForward10 size={28} />
          </button>
        ) : (
          <div style={{ width: 44 }} />
        )}
      </div>

      {/* Bottom bar */}
      <div className="player-bottom-bar">
        <div className="player-timeline" onClick={stop} onDoubleClick={stop}>
          <span className="timeline-time">{formatTime(currentTime)}</span>
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
                  {timelinePreview.image && (
                    <img src={timelinePreview.image} alt="" draggable={false} />
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
          </div>
          <span className="timeline-time right">{formatTime(duration)}</span>
        </div>

        <div className="player-actions-row">
          <div
            className="player-actions-left"
            onClick={stop}
            onDoubleClick={stop}
          >
            {chapters.length > 0 && (
              <div className="inline-menu-container">
                <button
                  className={`action-btn text-btn chapter-action ${openMenu === "chapters" ? "active" : ""}`}
                  onClick={(event) => toggleMenu(event, "chapters")}
                  title={activeChapter?.title || `${chapters.length} chapters`}
                >
                  <ChaptersIcon size={20} />
                  <span className="chapter-action-label">
                    {activeChapter?.title || "Chapters"}
                  </span>
                </button>
                {openMenu === "chapters" && (
                  <div
                    className="inline-menu left chapters-menu"
                    onClick={stop}
                  >
                    {chapters.map((chapter, index) => (
                      <button
                        key={`${chapter.time}-${index}`}
                        className={`inline-menu-item chapter-menu-item ${index === activeChapterIndex ? "selected" : ""}`}
                        onClick={() => {
                          onSeek(chapter.time);
                          setOpenMenu(null);
                        }}
                      >
                        <span className="chapter-menu-title">
                          {chapter.title}
                        </span>
                        <span className="chapter-menu-time">
                          {formatTime(chapter.time)}
                        </span>
                        {index === activeChapterIndex && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="inline-menu-container">
              <button
                className={`action-btn text-btn ${openMenu === "audio" ? "active" : ""}`}
                onClick={(e) => toggleMenu(e, "audio")}
              >
                <LuAudioLines size={20} />
                <span>
                  {(() => {
                    const sel = audioTracks.find((t) => t.selected);
                    if (sel?.lang) return sel.lang.toUpperCase().slice(0, 2);
                    if (sel) return `A${sel.id}`;
                    return "AUD";
                  })()}
                </span>
              </button>
              {openMenu === "audio" && (
                <div className="inline-menu left wide" onClick={stop}>
                  {audioTracks.length === 0 && (
                    <div className="inline-menu-item">No audio tracks</div>
                  )}
                  {audioTracks.map((t) => (
                    <button
                      key={t.id}
                      className={`inline-menu-item ${t.selected ? "selected" : ""}`}
                      onClick={() => {
                        onSelectAudioTrack(t.id);
                        setOpenMenu(null);
                      }}
                    >
                      <div className="track-details">
                        <span className="track-name">
                          {t.lang ? t.lang.toUpperCase() : `Track ${t.id}`}
                        </span>
                        {t.title && (
                          <span className="track-lang">{t.title}</span>
                        )}
                      </div>
                      {t.selected && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="inline-menu-container">
              <button
                className={`action-btn text-btn ${openMenu === "subtitle" ? "active" : ""}`}
                onClick={(e) => toggleMenu(e, "subtitle")}
              >
                <Subtitles size={20} />
                <span>
                  {subtitleTracks
                    .find((t) => t.selected)
                    ?.lang?.toUpperCase()
                    .slice(0, 2) || ""}
                </span>
              </button>
              {openMenu === "subtitle" && (
                <div className="inline-menu left wide" onClick={stop}>
                  <button
                    className={`inline-menu-item ${!subtitleTracks.some((t) => t.selected) ? "selected" : ""}`}
                    onClick={() => {
                      onSelectSubtitleTrack("no");
                      setOpenMenu(null);
                    }}
                  >
                    <span>Off</span>
                    {!subtitleTracks.some((t) => t.selected) && (
                      <Check size={14} />
                    )}
                  </button>
                  {subtitleTracks.map((t) => (
                    <button
                      key={t.id}
                      className={`inline-menu-item ${t.selected ? "selected" : ""}`}
                      onClick={() => {
                        onSelectSubtitleTrack(t.id);
                        setOpenMenu(null);
                      }}
                    >
                      <div className="track-details">
                        <span className="track-name">
                          {t.lang ? t.lang.toUpperCase() : `Track ${t.id}`}
                        </span>
                        {t.title && (
                          <span className="track-lang">{t.title}</span>
                        )}
                      </div>
                      {t.selected && <Check size={14} />}
                    </button>
                  ))}
                  <div
                    style={{
                      height: 1,
                      background: "rgba(255,255,255,0.1)",
                      margin: "4px 0",
                    }}
                  />
                  <button
                    className="inline-menu-item"
                    onClick={() => setShowOnlineSearch(true)}
                  >
                    <span>Search online...</span>
                  </button>
                  <button
                    className="inline-menu-item"
                    onClick={handleLoadLocalSubtitle}
                  >
                    <span>Load local subtitle...</span>
                  </button>
                </div>
              )}
            </div>

            <div className="inline-menu-container">
              <button
                className={`action-btn text-btn ${openMenu === "speed" ? "active" : ""}`}
                onClick={(e) => toggleMenu(e, "speed")}
              >
                <Gauge size={20} />
                <span>{playbackRate.toFixed(1)}x</span>
              </button>
              {openMenu === "speed" && (
                <div className="inline-menu left" onClick={stop}>
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                    <button
                      key={rate}
                      className={`inline-menu-item ${Math.abs(playbackRate - rate) < 0.01 ? "selected" : ""}`}
                      onClick={() => {
                        onPlaybackRateChange(rate);
                        setOpenMenu(null);
                      }}
                    >
                      <span>{rate}x</span>
                      {Math.abs(playbackRate - rate) < 0.01 && (
                        <Check size={14} />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div
            className="player-actions-right"
            onClick={stop}
            onDoubleClick={stop}
          >
            {onPlayNative && (
              <button className="action-btn text-btn" onClick={onPlayNative}>
                <Tv size={20} />
                <span>Native</span>
              </button>
            )}
            {showNextEpisode && nextEpisodeTitle && (
              <button className="next-episode-pill" onClick={onNextEpisode}>
                <span>Next: {nextEpisodeTitle}</span>
                <NextIcon size={16} />
              </button>
            )}

            <button
              className={`action-btn text-btn ${isPip ? "active" : ""}`}
              onClick={onTogglePip}
            >
              <PictureInPicture size={20} />
              <span>PIP</span>
            </button>

            <div className="inline-menu-container">
              <button
                className={`action-btn text-btn ${openMenu === "server" ? "active" : ""}`}
                onClick={(e) => toggleMenu(e, "server")}
              >
                <ServerIcon size={20} />
                <span>
                  {selectedStream?.server ||
                    selectedStream?.quality ||
                    "Server"}
                </span>
              </button>
              {openMenu === "server" && (
                <div className="inline-menu right wide" onClick={stop}>
                  {(!streamData || streamData.length === 0) && (
                    <div className="inline-menu-item">
                      No alternative servers
                    </div>
                  )}
                  {streamData?.map((s: any, idx: number) => (
                    <button
                      key={idx}
                      className={`inline-menu-item ${selectedStream?.link === s.link ? "selected" : ""}`}
                      onClick={() => {
                        onSelectStream && onSelectStream(s);
                        setOpenMenu(null);
                      }}
                    >
                      <div className="track-details">
                        <span className="track-name">
                          {s.server || `Server ${idx + 1}`}
                        </span>
                        {s.quality && (
                          <span className="track-lang">{s.quality}</span>
                        )}
                      </div>
                      {selectedStream?.link === s.link && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="inline-menu-container">
              <button
                className={`action-btn text-btn ${openMenu === "quality" ? "active" : ""}`}
                onClick={(e) => toggleMenu(e, "quality")}
              >
                {(() => {
                  const sel = videoTracks.find((t) => t.selected);
                  const h = sel
                    ? sel.demuxH || (sel.selected ? videoHeight : 0)
                    : 0;
                  const fallback = sel
                    ? selectedStream?.quality
                      ? selectedStream.quality
                      : sel.title || sel.codec?.split(" ")[0] || "Auto"
                    : "Auto";
                  const info = getQualityInfo(h, fallback);
                  const QualityIcon = !sel ? MdVideoSettings : info.Icon;
                  return (
                    <>
                      <QualityIcon size={20} />
                      <span>{info.text}</span>
                    </>
                  );
                })()}
              </button>
              {openMenu === "quality" && (
                <div className="inline-menu right wide" onClick={stop}>
                  <button
                    className={`inline-menu-item ${!videoTracks.some((t) => t.selected) ? "selected" : ""}`}
                    onClick={() => {
                      onSelectVideoTrack("auto");
                      setOpenMenu(null);
                    }}
                  >
                    <span>Auto</span>
                    {!videoTracks.some((t) => t.selected) && (
                      <Check size={14} />
                    )}
                  </button>
                  {videoTracks.map((t) => {
                    const h = t.demuxH || (t.selected ? videoHeight : 0);
                    const fallback =
                      t.selected && selectedStream?.quality
                        ? selectedStream.quality
                        : t.title || t.codec || `Track ${t.id}`;
                    const info = getQualityInfo(h, fallback);
                    const primary = info.text;
                    const secondary =
                      h || (t.selected && selectedStream?.quality)
                        ? t.title || t.codec
                        : null;
                    return (
                      <button
                        key={t.id}
                        className={`inline-menu-item ${t.selected ? "selected" : ""}`}
                        onClick={() => {
                          onSelectVideoTrack(t.id);
                          setOpenMenu(null);
                        }}
                      >
                        <div className="track-details">
                          <span className="track-name">{primary}</span>
                          {secondary && (
                            <span className="track-lang">{secondary}</span>
                          )}
                        </div>
                        {t.selected && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              className={`action-btn text-btn ${isCropped ? "active" : ""}`}
              onClick={onToggleCrop}
            >
              <RectangleHorizontal size={20} />
              <span
                style={{
                  display: "inline-block",
                  minWidth: "32px",
                  textAlign: "left",
                }}
              >
                {isCropped ? "Crop" : "Fit"}
              </span>
            </button>

            <button
              className="action-btn text-btn"
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>

            <div className="inline-menu-container">
              <button
                className={`action-btn text-btn ${openMenu === "more" ? "active" : ""}`}
                onClick={(event) => toggleMenu(event, "more")}
                title="More actions"
                aria-label="More player actions"
              >
                <MoreVertical size={21} />
              </button>
              {openMenu === "more" && (
                <div className="inline-menu right wide" onClick={stop}>
                  <div className="inline-menu-zoom-row">
                    <div className="inline-menu-zoom-label">
                      <ZoomIn size={18} />
                      <span>Zoom</span>
                    </div>
                    <div className="inline-menu-zoom-actions">
                      <button
                        type="button"
                        className="zoom-stepper-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onZoomOut?.();
                        }}
                        disabled={zoomLevel <= 50}
                        title="Zoom out (-10%)"
                        aria-label="Zoom out"
                      >
                        <Minus size={13} />
                      </button>
                      {isEditingZoom ? (
                        <div
                          className="zoom-input-wrapper"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            ref={zoomInputRef}
                            type="number"
                            min={50}
                            max={300}
                            step={1}
                            className="zoom-level-input"
                            value={customZoomInput}
                            onChange={(e) => setCustomZoomInput(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveCustomZoom();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setCustomZoomInput(String(zoomLevel));
                                setIsEditingZoom(false);
                              }
                            }}
                            onBlur={handleSaveCustomZoom}
                          />
                          <span className="zoom-input-percent">%</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`zoom-level-badge ${zoomLevel !== 100 ? "custom" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCustomZoomInput(String(zoomLevel));
                            setIsEditingZoom(true);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            onResetZoom?.();
                          }}
                          title="Click to enter custom zoom %, double-click to reset"
                        >
                          {zoomLevel}%
                        </button>
                      )}
                      <button
                        type="button"
                        className="zoom-stepper-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onZoomIn?.();
                        }}
                        disabled={zoomLevel >= 300}
                        title="Zoom in (+10%)"
                        aria-label="Zoom in"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                  {onToggleShortcuts && (
                    <button
                      className="inline-menu-item"
                      onClick={() => {
                        setOpenMenu(null);
                        onToggleShortcuts();
                      }}
                    >
                      <Keyboard size={18} />
                      <span>Keyboard shortcuts</span>
                    </button>
                  )}
                  {onOpenVlc && (
                    <button
                      className="inline-menu-item"
                      onClick={() => {
                        setOpenMenu(null);
                        onOpenVlc();
                      }}
                    >
                      <ExternalLink size={18} />
                      <span>Open in VLC</span>
                    </button>
                  )}
                  {onCopyLink && (
                    <button
                      className="inline-menu-item"
                      onClick={() => {
                        setOpenMenu(null);
                        onCopyLink();
                      }}
                    >
                      <Copy size={18} />
                      <span>Copy stream link</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showShortcuts && (
        <div
          className="player-shortcuts-overlay"
          onClick={onToggleShortcuts}
          onDoubleClick={stop}
        >
          <section
            className="player-shortcuts-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={stop}
          >
            <header>
              <div>
                <span>Player controls</span>
                <h2>Keyboard shortcuts</h2>
              </div>
              <button
                className="player-shortcuts-close"
                onClick={onToggleShortcuts}
                aria-label="Close keyboard shortcuts"
              >
                <X size={22} />
              </button>
            </header>
            <div className="player-shortcuts-grid">
              {[
                ["Space / K", "Play or pause"],
                ["← / →", "Seek 10 seconds"],
                ["↑ / ↓", "Change volume"],
                ["A", "Next audio track"],
                ["T", "Next subtitle track"],
                ["Shift + , / .", "Decrease or increase speed"],
                ["+ / -", "Zoom in or out"],
                ["0", "Reset zoom (100%)"],
                ["S", "Skip to next chapter"],
                ["M", "Mute or unmute"],
                ["F", "Toggle fullscreen"],
                ["N", "Next episode"],
                ["?", "Show or hide shortcuts"],
                ["Esc", "Close or go back"],
              ].map(([shortcut, action]) => (
                <div className="player-shortcut-row" key={shortcut}>
                  <kbd>{shortcut}</kbd>
                  <span>{action}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {showOnlineSearch && (
        <SearchSubtitlesModal
          initialSearchQuery={primaryTitle}
          onClose={() => setShowOnlineSearch(false)}
          onSelectSubtitle={(url) => {
            onAddSubtitleFile?.(url);
            setOpenMenu(null);
          }}
        />
      )}
    </div>
  );
};

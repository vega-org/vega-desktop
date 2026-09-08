import React, { useCallback, useRef, useState, useEffect } from "react";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import {
  LuArrowLeft as ArrowLeft,
  LuPlay as Play,
  LuPause as Pause,
  LuMaximize as Maximize,
  LuMinimize as Minimize,
  LuChevronsRight as ChevronsRight,
  LuSkipForward as NextIcon,
  LuCaptions as Subtitles,
  LuGauge as Gauge,
  LuPictureInPicture as PictureInPicture,
  LuRectangleHorizontal as RectangleHorizontal,
  LuServer as ServerIcon,
  LuTv as Tv,
  LuAudioLines,
  LuList as ChaptersIcon,
  LuX as X,
  LuEllipsisVertical as MoreVertical,
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
import type { SkipInterval } from "../lib/providers/types";
import { SearchSubtitlesModal } from "../components/SearchSubtitlesModal";
import { settingsStorage } from "../lib/storage";
import { FocusableButton } from "../components/layout/FocusableButton";
import { ControlsFocusProvider } from "../lib/context/ControlsFocusContext";
import { TimelineScrubber } from "../components/player/TimelineScrubber";
import { AudioTrackMenu } from "../components/player/AudioTrackMenu";
import { SubtitleTrackMenu } from "../components/player/SubtitleTrackMenu";
import { ServerSelectMenu } from "../components/player/ServerSelectMenu";
import { QualitySelectMenu } from "../components/player/QualitySelectMenu";
import { SpeedSelectMenu } from "../components/player/SpeedSelectMenu";
import { ChaptersMenu } from "../components/player/ChaptersMenu";
import { MoreOptionsMenu } from "../components/player/MoreOptionsMenu";
import { useDialogFocusBoundary } from "../lib/hooks/useDialogFocusBoundary";

interface PlayerControlsProps {
  visible: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  cacheDuration?: number;
  skips?: SkipInterval[];
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
  audioDelay?: number;
  onAudioDelayChange?: (delayMs: number) => void;
  subtitleDelay?: number;
  onSubtitleDelayChange?: (delayMs: number) => void;
  chapters?: MpvChapter[];
  videoHeight?: number;
  playbackRate: number;
  streamData?: any;
  selectedStream?: any;
  onSelectStream?: (stream: any) => void;
  onSelectAudioTrack: (id: number | "no" | "auto") => void;
  onSelectSubtitleTrack: (id: number | "no" | "auto") => void;
  onSelectVideoTrack: (id: number | "no" | "auto") => void;
  onAddSubtitleFile?: (path: string, title?: string) => void;
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

export function getQualityInfo(h: number, fallbackStr: string) {
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

export function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const stop = (e: React.MouseEvent) => e.stopPropagation();

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  visible,
  isPaused,
  isBuffering,
  currentTime,
  duration,
  cacheDuration,
  skips,
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
  audioDelay = 0,
  onAudioDelayChange,
  subtitleDelay = 0,
  onSubtitleDelayChange,
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
  showShortcuts,
  onToggleShortcuts,
  onRequestThumbnail,
  thumbnailKey,
  onScrubbingChange,
}) => {
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref: containerRef, focusKey, focusSelf } = useFocusable({
    trackChildren: true,
    saveLastFocusedChild: true,
    preferredChildFocusKey: "PLAYER_PLAY_PAUSE",
    focusable: visible && tvMode,
  });

  const {
    ref: shortcutsRef,
    DialogFocusProvider: ShortcutsDialogFocusProvider,
  } = useDialogFocusBoundary({
    isOpen: Boolean(showShortcuts),
    focusKey: "PLAYER_SHORTCUTS_DIALOG",
    preferredChildFocusKey: "SHORTCUTS_CLOSE",
    restoreFocusKey: "PLAYER_MORE",
  });

  const activeSkip = skips?.find(
    (s) => currentTime >= s.from && currentTime < s.to,
  );
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
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null);
  const pendingSeekTimerRef = useRef<number | null>(null);
  const showSeekButtons = !settingsStorage.hideSeekButtons();

  // Focus play button when controls become visible in TV mode
  useEffect(() => {
    if (visible && tvMode) {
      const timer = setTimeout(() => {
        focusSelf();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setOpenMenu(null);
    }
  }, [visible, tvMode, focusSelf]);

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
        const filename = selected.split(/[/\\]/).pop() || "Local Subtitle";
        onAddSubtitleFile?.(selected, filename);
        setOpenMenu(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const renderedTime =
    draggingTimelineRef.current && timelinePreview
      ? timelinePreview.time
      : pendingSeekTime !== null
        ? pendingSeekTime
        : currentTime;
  const progressPercent = duration > 0 ? (renderedTime / duration) * 100 : 0;
  const cachePercent =
    duration > 0
      ? Math.min(((currentTime + (cacheDuration || 0)) / duration) * 100, 100)
      : 0;
  let activeChapterIndex = -1;
  for (let index = 0; index < chapters.length; index++) {
    if (chapters[index].time <= renderedTime + 0.25) activeChapterIndex = index;
    else break;
  }
  const activeChapter = chapters[activeChapterIndex];

  useEffect(() => {
    if (pendingSeekTime !== null) {
      if (!isBuffering || Math.abs(currentTime - pendingSeekTime) <= 1.2) {
        setPendingSeekTime(null);
        if (pendingSeekTimerRef.current) {
          clearTimeout(pendingSeekTimerRef.current);
          pendingSeekTimerRef.current = null;
        }
      }
    }
  }, [currentTime, pendingSeekTime, isBuffering]);

  useEffect(() => {
    return () => {
      if (pendingSeekTimerRef.current) {
        clearTimeout(pendingSeekTimerRef.current);
      }
    };
  }, []);

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

      if (cached === undefined && onRequestThumbnail) {
        if (pendingPreviewBucketRef.current === null) {
          pendingPreviewBucketRef.current = bucket;
          const requestId = ++previewRequestRef.current;
          onRequestThumbnail(bucket)
            .then((img) => {
              thumbnailCacheRef.current.set(bucket, img);
              if (previewRequestRef.current === requestId) {
                setTimelinePreview((current) =>
                  current?.bucket === bucket
                    ? { ...current, image: img }
                    : current,
                );
              }
            })
            .finally(() => {
              pendingPreviewBucketRef.current = null;
              const nextBucket = queuedPreviewBucketRef.current;
              queuedPreviewBucketRef.current = null;
              if (
                nextBucket !== null &&
                thumbnailCacheRef.current.get(nextBucket) === undefined
              ) {
                pendingPreviewBucketRef.current = nextBucket;
                const nextRequestId = ++previewRequestRef.current;
                onRequestThumbnail(nextBucket)
                  .then((img) => {
                    thumbnailCacheRef.current.set(nextBucket, img);
                    if (previewRequestRef.current === nextRequestId) {
                      setTimelinePreview((current) =>
                        current?.bucket === nextBucket
                          ? { ...current, image: img }
                          : current,
                      );
                    }
                  })
                  .finally(() => {
                    pendingPreviewBucketRef.current = null;
                  });
              }
            });
        } else {
          queuedPreviewBucketRef.current = bucket;
        }
      }

      return time;
    },
    [duration, onRequestThumbnail],
  );

  const handleTrackMouseDown = useCallback(
    (e: React.MouseEvent) => {
      draggingTimelineRef.current = true;
      onScrubbingChange?.(true);
      const startTime = updateTimelinePreview(e);
      if (startTime !== null) {
        setPendingSeekTime(startTime);
      }

      const onMove = (ev: MouseEvent) => {
        const moveTime = updateTimelinePreview(ev);
        if (moveTime !== null) {
          setPendingSeekTime(moveTime);
        }
      };
      const onUp = (ev: MouseEvent) => {
        const seekTime = updateTimelinePreview(ev);
        draggingTimelineRef.current = false;
        onScrubbingChange?.(false);
        setTimelinePreview(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        if (seekTime !== null) {
          setPendingSeekTime(seekTime);
          onSeek(seekTime);
          if (pendingSeekTimerRef.current) {
            clearTimeout(pendingSeekTimerRef.current);
          }
          pendingSeekTimerRef.current = window.setTimeout(() => {
            setPendingSeekTime(null);
          }, 2000);
        } else {
          setPendingSeekTime(null);
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [onScrubbingChange, onSeek, updateTimelinePreview],
  );

  const handleCenterSeek = useCallback(
    (targetTime: number) => {
      const clamped = Math.max(0, Math.min(duration || targetTime, targetTime));
      setPendingSeekTime(clamped);
      onSeek(clamped);
      if (pendingSeekTimerRef.current) {
        clearTimeout(pendingSeekTimerRef.current);
      }
      pendingSeekTimerRef.current = window.setTimeout(() => {
        setPendingSeekTime(null);
      }, 2000);
    },
    [duration, onSeek],
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
      <ControlsFocusProvider visible={visible}>
        <FocusContext.Provider value={focusKey}>
          <div
            ref={containerRef}
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
                <FocusableButton
                  className="center-btn play-pause"
                  focusable={true}
                  focusKey="PLAYER_PIP_PLAY"
                  onClick={onTogglePause}
                  onMouseDown={stop}
                >
                  {isPaused ? (
                    <Play size={32} fill="#fff" />
                  ) : (
                    <Pause size={32} />
                  )}
                </FocusableButton>
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
            <FocusableButton
              className="pip-exit-btn"
              focusable={true}
              focusKey="PLAYER_PIP_EXIT"
              onClick={onTogglePip}
              onMouseDown={stop}
            >
              <Minimize size={16} />
            </FocusableButton>
          </div>
        </FocusContext.Provider>
      </ControlsFocusProvider>
    );
  }

  return (
    <ControlsFocusProvider visible={visible}>
      <FocusContext.Provider value={focusKey}>
        <div
          ref={containerRef}
        className={`player-controls-wrapper ${visible ? "visible" : ""}`}
        onClick={onClickBackground}
        onDoubleClick={onToggleFullscreen}
      >
        <div className="controls-gradient-top" />
        <div className="controls-gradient-bottom" />

        {/* Top bar */}
        <div className="player-top-bar">
          <FocusableButton
            className="player-back-btn"
            focusable={true}
            focusKey="PLAYER_BACK"
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft size={22} />
          </FocusableButton>
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
            <FocusableButton
              className="center-btn"
              focusable={true}
              focusKey="PLAYER_REWIND"
              onClick={() =>
                handleCenterSeek(
                  Math.max(0, (pendingSeekTime ?? currentTime) - 10),
                )
              }
              title="Rewind 10 seconds"
              aria-label="Rewind 10 seconds"
            >
              <MdReplay10 size={28} />
            </FocusableButton>
          ) : (
            <div style={{ width: 44 }} />
          )}

          {!isBuffering ? (
            <FocusableButton
              className="center-btn play-pause"
              focusable={true}
              focusKey="PLAYER_PLAY_PAUSE"
              onClick={onTogglePause}
              aria-label={isPaused ? "Play" : "Pause"}
            >
              {isPaused ? <Play size={32} fill="#fff" /> : <Pause size={32} />}
            </FocusableButton>
          ) : (
            <div className="center-btn play-pause" style={{ cursor: "default" }}>
              <div
                className="loading-spinner"
                style={{ width: 28, height: 28, borderWidth: 2 }}
              />
            </div>
          )}

          {showSeekButtons ? (
            <FocusableButton
              className="center-btn"
              focusable={true}
              focusKey="PLAYER_FORWARD"
              onClick={() =>
                handleCenterSeek(
                  Math.min(
                    duration || currentTime + 10,
                    (pendingSeekTime ?? currentTime) + 10,
                  ),
                )
              }
              title="Forward 10 seconds"
              aria-label="Forward 10 seconds"
            >
              <MdForward10 size={28} />
            </FocusableButton>
          ) : (
            <div style={{ width: 44 }} />
          )}
        </div>

        {/* Bottom bar */}
        <div className="player-bottom-bar">
          <TimelineScrubber
            focusable={visible && tvMode}
            duration={duration}
            currentTime={currentTime}
            pendingSeekTime={pendingSeekTime}
            renderedTime={renderedTime}
            progressPercent={progressPercent}
            cachePercent={cachePercent}
            formatTime={formatTime}
            onSeek={onSeek}
            onScrubbingChange={onScrubbingChange}
            chapters={chapters}
            skips={skips}
            timelinePreview={timelinePreview}
            setTimelinePreview={setTimelinePreview}
            updateTimelinePreview={updateTimelinePreview}
            draggingTimelineRef={draggingTimelineRef}
            trackRef={trackRef}
            handleTrackMouseDown={handleTrackMouseDown}
          />

          <div className="player-actions-row">
            <div
              className="player-actions-left"
              onClick={stop}
              onDoubleClick={stop}
            >
              {chapters.length > 0 && (
                <div className="inline-menu-container">
                  <FocusableButton
                    focusable={true}
                    focusKey="PLAYER_CHAPTERS"
                    className={`action-btn text-btn chapter-action ${openMenu === "chapters" ? "active" : ""}`}
                    onClick={(event) => toggleMenu(event, "chapters")}
                    title={activeChapter?.title || `${chapters.length} chapters`}
                  >
                    <ChaptersIcon size={20} />
                    <span className="chapter-action-label">
                      {activeChapter?.title || "Chapters"}
                    </span>
                  </FocusableButton>
                  {openMenu === "chapters" && (
                    <ChaptersMenu
                      chapters={chapters}
                      activeChapterIndex={activeChapterIndex}
                      formatTime={formatTime}
                      onSeek={onSeek}
                      onClose={() => setOpenMenu(null)}
                    />
                  )}
                </div>
              )}

              <div className="inline-menu-container">
                <FocusableButton
                  focusable={true}
                  focusKey="PLAYER_AUDIO"
                  className={`action-btn text-btn ${openMenu === "audio" ? "active" : ""}`}
                  onClick={(e) => toggleMenu(e, "audio")}
                >
                  <LuAudioLines size={20} />
                  <span>
                    {(() => {
                      const sel = audioTracks.find((t) => t.selected);
                      if (sel?.lang && sel.lang !== "und") return sel.lang.toUpperCase().slice(0, 2);
                      if (sel?.title && !sel.title.toLowerCase().includes("default")) {
                        return sel.title.slice(0, 3).toUpperCase();
                      }
                      return "AUD";
                    })()}
                  </span>
                </FocusableButton>
                {openMenu === "audio" && (
                  <AudioTrackMenu
                    audioTracks={audioTracks}
                    audioDelay={audioDelay}
                    onAudioDelayChange={onAudioDelayChange}
                    onSelectAudioTrack={onSelectAudioTrack}
                    onClose={() => setOpenMenu(null)}
                  />
                )}
              </div>

              <div className="inline-menu-container">
                <FocusableButton
                  focusable={true}
                  focusKey="PLAYER_SUBTITLES"
                  className={`action-btn text-btn ${openMenu === "subtitle" ? "active" : ""}`}
                  onClick={(e) => toggleMenu(e, "subtitle")}
                >
                  <Subtitles size={20} />
                  <span>
                    {(() => {
                      const sel = subtitleTracks.find((t) => t.selected);
                      if (!sel) return "";
                      if (sel.lang && sel.lang !== "und") return sel.lang.toUpperCase().slice(0, 2);
                      if (sel.title) return sel.title.slice(0, 3).toUpperCase();
                      return "SUB";
                    })()}
                  </span>
                </FocusableButton>
                {openMenu === "subtitle" && (
                  <SubtitleTrackMenu
                    subtitleTracks={subtitleTracks}
                    subtitleDelay={subtitleDelay}
                    onSubtitleDelayChange={onSubtitleDelayChange}
                    onSelectSubtitleTrack={onSelectSubtitleTrack}
                    onShowOnlineSearch={() => setShowOnlineSearch(true)}
                    onLoadLocalSubtitle={handleLoadLocalSubtitle}
                    onClose={() => setOpenMenu(null)}
                  />
                )}
              </div>

              <div className="inline-menu-container">
                <FocusableButton
                  focusable={true}
                  focusKey="PLAYER_SPEED"
                  className={`action-btn text-btn ${openMenu === "speed" ? "active" : ""}`}
                  onClick={(e) => toggleMenu(e, "speed")}
                >
                  <Gauge size={20} />
                  <span>{playbackRate.toFixed(1)}x</span>
                </FocusableButton>
                {openMenu === "speed" && (
                  <SpeedSelectMenu
                    playbackRate={playbackRate}
                    onPlaybackRateChange={onPlaybackRateChange}
                    onClose={() => setOpenMenu(null)}
                  />
                )}
              </div>
            </div>

            <div
              className="player-actions-right"
              onClick={stop}
              onDoubleClick={stop}
            >
              {onPlayNative && (
                <FocusableButton
                  focusable={true}
                  focusKey="PLAYER_NATIVE"
                  className="action-btn text-btn"
                  onClick={onPlayNative}
                >
                  <Tv size={20} />
                  <span>Native</span>
                </FocusableButton>
              )}
              {showNextEpisode && nextEpisodeTitle && (
                <FocusableButton
                  focusable={true}
                  focusKey="PLAYER_NEXT_EP"
                  className="next-episode-pill"
                  onClick={onNextEpisode}
                >
                  <span>Next: {nextEpisodeTitle}</span>
                  <NextIcon size={16} />
                </FocusableButton>
              )}

              <FocusableButton
                focusable={true}
                focusKey="PLAYER_PIP"
                className={`action-btn text-btn ${isPip ? "active" : ""}`}
                onClick={onTogglePip}
              >
                <PictureInPicture size={20} />
                <span>PIP</span>
              </FocusableButton>

              <div className="inline-menu-container">
                <FocusableButton
                  focusable={true}
                  focusKey="PLAYER_SERVER"
                  className={`action-btn text-btn ${openMenu === "server" ? "active" : ""}`}
                  onClick={(e) => toggleMenu(e, "server")}
                >
                  <ServerIcon size={20} />
                  <span>
                    {selectedStream?.server ||
                      selectedStream?.quality ||
                      "Server"}
                  </span>
                </FocusableButton>
                {openMenu === "server" && (
                  <ServerSelectMenu
                    streamData={streamData}
                    selectedStream={selectedStream}
                    onSelectStream={onSelectStream}
                    onClose={() => setOpenMenu(null)}
                  />
                )}
              </div>

              <div className="inline-menu-container">
                <FocusableButton
                  focusable={true}
                  focusKey="PLAYER_QUALITY"
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
                </FocusableButton>
                {openMenu === "quality" && (
                  <QualitySelectMenu
                    videoTracks={videoTracks}
                    videoHeight={videoHeight}
                    selectedStream={selectedStream}
                    getQualityInfo={getQualityInfo}
                    onSelectVideoTrack={onSelectVideoTrack}
                    onClose={() => setOpenMenu(null)}
                  />
                )}
              </div>

              <FocusableButton
                focusable={true}
                focusKey="PLAYER_CROP"
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
              </FocusableButton>

              <FocusableButton
                focusable={true}
                focusKey="PLAYER_FULLSCREEN"
                className="action-btn text-btn"
                onClick={onToggleFullscreen}
              >
                {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
              </FocusableButton>

              <div className="inline-menu-container">
                <FocusableButton
                  focusable={true}
                  focusKey="PLAYER_MORE"
                  className={`action-btn text-btn ${openMenu === "more" ? "active" : ""}`}
                  onClick={(event) => toggleMenu(event, "more")}
                  title="More actions"
                  aria-label="More player actions"
                >
                  <MoreVertical size={21} />
                </FocusableButton>
                {openMenu === "more" && (
                  <MoreOptionsMenu
                    zoomLevel={zoomLevel}
                    onZoomIn={onZoomIn}
                    onZoomOut={onZoomOut}
                    onResetZoom={onResetZoom}
                    onSetZoom={onSetZoom}
                    onToggleShortcuts={onToggleShortcuts}
                    onOpenVlc={onOpenVlc}
                    onCopyLink={onCopyLink}
                    onClose={() => setOpenMenu(null)}
                  />
                )}
              </div>
            </div>
          </div>

          {activeSkip && (
            <FocusableButton
              focusable={true}
              focusKey="PLAYER_SKIP_INTRO"
              className="player-skip-btn"
              onClick={(e) => {
                stop(e);
                onSeek(activeSkip.to);
              }}
              title={`Skip to ${formatTime(activeSkip.to)}`}
            >
              <span>
                {activeSkip.title
                  ? activeSkip.title.toLowerCase().startsWith("skip")
                    ? activeSkip.title
                    : `Skip ${activeSkip.title}`
                  : "Skip Intro"}
              </span>
              <ChevronsRight size={18} />
            </FocusableButton>
          )}
        </div>

        {showShortcuts && (
          <ShortcutsDialogFocusProvider>
            <div
              className="player-shortcuts-overlay"
              onClick={onToggleShortcuts}
              onDoubleClick={stop}
            >
              <section
                ref={shortcutsRef as any}
                className="player-shortcuts-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Keyboard shortcuts"
                onClick={stop}
              >
              <header>
                <div>
                  <span>Player controls</span>
                  <h2>Keyboard & Remote shortcuts</h2>
                </div>
                <FocusableButton
                  focusable={true}
                  focusKey="SHORTCUTS_CLOSE"
                  className="player-shortcuts-close"
                  onClick={onToggleShortcuts}
                  aria-label="Close keyboard shortcuts"
                >
                  <X size={22} />
                </FocusableButton>
              </header>
              <div className="player-shortcuts-grid">
                {[
                  ["D-Pad / Arrows", "Navigate controls and scrub timeline"],
                  ["OK / Enter / A Button", "Select focused control or play/pause"],
                  ["Back / B Button / Esc", "Close menus / Hide controls / Exit"],
                  ["Space / K (or X Button)", "Play or pause"],
                  ["← / → (or J / L)", "Rewind 10s / Fast Forward 10s"],
                  ["↑ / ↓", "Change volume (+/- 5%)"],
                  ["Y Button", "Toggle episode drawer"],
                  ["LB / RB (or LT / RT)", "Rewind 10s / Fast Forward 10s"],
                  ["A", "Next audio track"],
                  ["Z / X (or [ / ])", "Adjust audio sync (+/- 50ms)"],
                  ["C / T", "Next subtitle track / toggle"],
                  ["G / H", "Adjust subtitle sync (+/- 50ms)"],
                  ["Shift + , / .", "Decrease or increase speed"],
                  ["+ / -", "Zoom in or out"],
                  ["0", "Reset zoom (100%)"],
                  ["S", "Skip intro / interval (Ctrl+S for chapter)"],
                  ["M", "Mute or unmute"],
                  ["F", "Toggle fullscreen"],
                  ["I", "Toggle picture-in-picture"],
                  ["N / P", "Next / Previous episode"],
                  ["?", "Show or hide shortcuts"],
                ].map(([shortcut, action]) => (
                  <div className="player-shortcut-row" key={shortcut}>
                    <kbd>{shortcut}</kbd>
                    <span>{action}</span>
                  </div>
                ))}
              </div>
              </section>
            </div>
          </ShortcutsDialogFocusProvider>
        )}

        {showOnlineSearch && (
          <SearchSubtitlesModal
            initialSearchQuery={primaryTitle}
            onClose={() => setShowOnlineSearch(false)}
            onSelectSubtitle={(url, title) => {
              onAddSubtitleFile?.(url, title);
              setOpenMenu(null);
            }}
          />
        )}
      </div>
    </FocusContext.Provider>
  </ControlsFocusProvider>
  );
};

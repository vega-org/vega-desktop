import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { MpvTrack } from "../lib/player/PlayerEngine";
import { usePlayerEngine } from "../lib/hooks/usePlayerEngine";
import { useStream } from "../lib/hooks/useStream";
import { usePlayerProgress } from "../lib/hooks/usePlayerSettings";
import { useMediaSession } from "../lib/hooks/useMediaSession";
import useContentStore from "../lib/zustand/contentStore";
import useWatchHistoryStore from "../lib/zustand/watchHistrory";
import { useDownloadStore } from "../lib/zustand/downloadStore";
import { cacheStorage, mainStorage } from "../lib/storage";
import { PlayerControls } from "./PlayerControls";
import { PlayerInitError } from "./PlayerInitError";
import type { SkipInterval } from "../lib/providers/types";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { FocusableButton } from "../components/layout/FocusableButton";
import { AnimatedHourglass } from "../components/AnimatedHourglass";
import { syncFromSharedFolder } from "../lib/sync/syncService";
import { settingsStorage } from "../lib/storage/SettingsStorage";
import { useArtworkPalette } from "../lib/hooks/useArtworkPalette";
import { ControlsFocusProvider } from "../lib/context/ControlsFocusContext";
import {
  isTorrentUrl,
  resolveTorrentStreamUrl,
} from "../lib/services/torrentStreamService";

import {
  LuArrowLeft as ArrowLeft,
  LuChevronLeft as ChevronLeft,
  LuExternalLink as ExternalLink,
  LuList as ListIcon,
  LuPlay as Play,
  LuServer as Server,
  LuX as CloseIcon,
} from "react-icons/lu";
import "./PlayerPage.css";

interface PlayerLocationState {
  episodeList: any[];
  linkIndex: number;
  primaryTitle: string;
  secondaryTitle?: string;
  type: string;
  poster?: { poster?: string; logo?: string; background?: string };
  providerValue: string;
  infoUrl: string;
  doNotTrack?: boolean;
}

interface MediaTrackPreference {
  audioLang?: string;
  audioTitle?: string;
  audioLabel?: string;
  audioIndex?: number;
  subLang?: string;
  subTitle?: string;
  subLabel?: string;
  subIndex?: number;
  subOff?: boolean;
}

const getMediaPrefKey = (state?: PlayerLocationState | null) => {
  const rawId = state?.infoUrl || state?.primaryTitle || "";
  return `media_tracks_${rawId}`;
};

const getSavedTrackPreference = (
  state?: PlayerLocationState | null,
): MediaTrackPreference | null => {
  if (!state) return null;
  const key = getMediaPrefKey(state);
  return mainStorage.getObject<MediaTrackPreference>(key) || null;
};

const saveAudioPreference = (
  state: PlayerLocationState | undefined,
  track: MpvTrack,
  index?: number,
) => {
  if (!state) return;
  const key = getMediaPrefKey(state);
  const current = mainStorage.getObject<MediaTrackPreference>(key) || {};
  mainStorage.setObject<MediaTrackPreference>(key, {
    ...current,
    audioLang: track.lang?.trim() || undefined,
    audioTitle: track.title?.trim() || undefined,
    audioLabel: formatTrackLabel(track),
    audioIndex: index,
  });
};

const saveSubtitlePreference = (
  state: PlayerLocationState | undefined,
  trackOrOff: MpvTrack | "off",
  index?: number,
) => {
  if (!state) return;
  const key = getMediaPrefKey(state);
  const current = mainStorage.getObject<MediaTrackPreference>(key) || {};
  if (trackOrOff === "off") {
    mainStorage.setObject<MediaTrackPreference>(key, {
      ...current,
      subOff: true,
      subLang: undefined,
      subTitle: undefined,
      subLabel: undefined,
      subIndex: undefined,
    });
  } else {
    mainStorage.setObject<MediaTrackPreference>(key, {
      ...current,
      subOff: false,
      subLang: trackOrOff.lang?.trim() || undefined,
      subTitle: trackOrOff.title?.trim() || undefined,
      subLabel: formatTrackLabel(trackOrOff),
      subIndex: index,
    });
  }
};

function findBestMatchingAudioTrack(
  tracks: MpvTrack[],
  saved: MediaTrackPreference,
): MpvTrack | undefined {
  if (!tracks.length) return undefined;

  if (saved.audioLang) {
    const sl = saved.audioLang.trim().toLowerCase();
    const match = tracks.find((t) => {
      const l = t.lang?.trim().toLowerCase();
      if (!l) return false;
      if (l === sl) return true;
      if (l.length >= 2 && sl.length >= 2 && l.slice(0, 2) === sl.slice(0, 2)) {
        return true;
      }
      return false;
    });
    if (match) return match;
  }

  if (saved.audioLabel) {
    const match = tracks.find(
      (t) =>
        formatTrackLabel(t).toLowerCase() === saved.audioLabel!.toLowerCase(),
    );
    if (match) return match;
  }

  if (saved.audioTitle) {
    const st = saved.audioTitle.trim().toLowerCase();
    const match = tracks.find((t) => {
      const title = t.title?.trim().toLowerCase();
      if (!title) return false;
      return title === st || title.includes(st) || st.includes(title);
    });
    if (match) return match;
  }

  if (saved.audioLang) {
    const sl = saved.audioLang.trim().toLowerCase();
    const match = tracks.find((t) => {
      const title = t.title?.trim().toLowerCase();
      return Boolean(title && title.includes(sl));
    });
    if (match) return match;
  }

  if (
    saved.audioIndex !== undefined &&
    saved.audioIndex >= 0 &&
    saved.audioIndex < tracks.length
  ) {
    return tracks[saved.audioIndex];
  }

  return undefined;
}

function findBestMatchingSubtitleTrack(
  tracks: MpvTrack[],
  saved: MediaTrackPreference,
): MpvTrack | undefined {
  if (!tracks.length) return undefined;

  if (saved.subLang) {
    const sl = saved.subLang.trim().toLowerCase();
    const isLangMatch = (t: MpvTrack) => {
      const l = t.lang?.trim().toLowerCase();
      if (!l) return false;
      if (l === sl) return true;
      return l.length >= 2 && sl.length >= 2 && l.slice(0, 2) === sl.slice(0, 2);
    };
    const textMatch = tracks.find((t) => !(t as any).isBitmapSub && isLangMatch(t));
    if (textMatch) return textMatch;
    const match = tracks.find(isLangMatch);
    if (match) return match;
  }

  if (saved.subLabel) {
    const isLabelMatch = (t: MpvTrack) =>
      formatTrackLabel(t).toLowerCase() === saved.subLabel!.toLowerCase();
    const textMatch = tracks.find((t) => !(t as any).isBitmapSub && isLabelMatch(t));
    if (textMatch) return textMatch;
    const match = tracks.find(isLabelMatch);
    if (match) return match;
  }

  if (saved.subTitle) {
    const st = saved.subTitle.trim().toLowerCase();
    const isTitleMatch = (t: MpvTrack) => {
      const title = t.title?.trim().toLowerCase();
      if (!title) return false;
      return title === st || title.includes(st) || st.includes(title);
    };
    const textMatch = tracks.find((t) => !(t as any).isBitmapSub && isTitleMatch(t));
    if (textMatch) return textMatch;
    const match = tracks.find(isTitleMatch);
    if (match) return match;
  }

  if (saved.subLang) {
    const sl = saved.subLang.trim().toLowerCase();
    const isLangInTitle = (t: MpvTrack) => {
      const title = t.title?.trim().toLowerCase();
      return Boolean(title && title.includes(sl));
    };
    const textMatch = tracks.find((t) => !(t as any).isBitmapSub && isLangInTitle(t));
    if (textMatch) return textMatch;
    const match = tracks.find(isLangInTitle);
    if (match) return match;
  }

  if (
    saved.subIndex !== undefined &&
    saved.subIndex >= 0 &&
    saved.subIndex < tracks.length
  ) {
    return tracks[saved.subIndex];
  }

  const downloadedTrack = tracks.find((t) => {
    const title = t.title?.toLowerCase() || "";
    return title.includes("downloaded") || title.includes("local");
  });
  if (downloadedTrack) return downloadedTrack;

  return undefined;
}

const formatTrackLabel = (track: {
  id: number;
  title?: string;
  lang?: string;
}) => {
  const title = track.title?.trim();
  const language = track.lang?.trim();
  if (
    title &&
    language &&
    title.toLocaleLowerCase() !== language.toLocaleLowerCase()
  ) {
    return `${title} · ${language.toUpperCase()}`;
  }
  return title || language?.toUpperCase() || `Track ${track.id}`;
};

export const PlayerPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as PlayerLocationState | undefined;
  const [syncReady, setSyncReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    syncFromSharedFolder()
      .catch((error) => console.warn("[VegaSync] Player sync failed:", error))
      .finally(() => {
        if (mounted) setSyncReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!state) {
    return (
      <div className="player-page">
        <div className="player-error">
          <p>No playback data provided.</p>
          <button onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    );
  }

  if (!syncReady) {
    return (
      <div className="player-page">
        <div className="player-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return <PlayerInner key={state.infoUrl} state={state} />;
};

interface PlayerInnerProps {
  state: PlayerLocationState;
}

const PlayerInner: React.FC<PlayerInnerProps> = ({ state }) => {
  const { provider } = useContentStore();
  const [activeEpisodeIndex, setActiveEpisodeIndex] = useState(state.linkIndex);
  const activeEpisode = state.episodeList[activeEpisodeIndex];
  const dynamicInfoThemeEnabled =
    settingsStorage.isInfoPageDynamicThemeEnabled();
  const hourglassArtwork = dynamicInfoThemeEnabled
    ? state.poster?.poster || state.poster?.background
    : null;
  const artworkPalette = useArtworkPalette(hourglassArtwork);
  const hourglassSandColor = artworkPalette["--primary"] || "var(--primary)";

  const routeParams = useMemo(
    () => ({
      episodeList: state.episodeList,
      linkIndex: activeEpisodeIndex,
      type: state.type,
      primaryTitle: state.primaryTitle,
      secondaryTitle: state.secondaryTitle,
      providerValue: state.providerValue,
      infoUrl: state.infoUrl,
      doNotTrack: state.doNotTrack,
      poster: state.poster,
    }),
    [state, activeEpisodeIndex],
  );

  const {
    streamData,
    selectedStream,
    setSelectedStream,
    externalSubs,
    isLoading: streamLoading,
    error: streamError,
  } = useStream({
    activeEpisode,
    routeParams,
    provider: state.providerValue || provider?.value || "",
  });

  const isAndroid = navigator.userAgent.toLowerCase().includes("android");
  const useExternalPlayer =
    isAndroid && settingsStorage.isExternalPlayerEnabled();
  const useVlc = !isAndroid && settingsStorage.isVlcEnabled();

  if (isAndroid || useVlc) {
    return (
      <TvPlayer
        state={state}
        activeEpisode={activeEpisode}
        streamLoading={streamLoading}
        streamError={streamError}
        streamData={streamData}
        selectedStream={selectedStream}
        setSelectedStream={setSelectedStream}
        isAndroid={isAndroid}
        useExternalPlayer={useExternalPlayer}
        useVlc={useVlc}
        hourglassSandColor={hourglassSandColor}
      />
    );
  }
  return (
    <DesktopPlayer
      state={state}
      activeEpisode={activeEpisode}
      activeEpisodeIndex={activeEpisodeIndex}
      setActiveEpisodeIndex={setActiveEpisodeIndex}
      streamLoading={streamLoading}
      streamError={streamError}
      streamData={streamData}
      selectedStream={selectedStream}
      setSelectedStream={setSelectedStream}
      externalSubs={externalSubs}
      routeParams={routeParams}
      hourglassSandColor={hourglassSandColor}
    />
  );
};

const TvPlayer: React.FC<any> = ({
  state,
  activeEpisode,
  streamLoading,
  streamError,
  streamData,
  selectedStream,
  setSelectedStream,
  isAndroid,
  useExternalPlayer,
  useVlc,
  hourglassSandColor,
}) => {
  const navigate = useNavigate();
  const { addItem } = useWatchHistoryStore();
  const [isLaunching, setIsLaunching] = useState(false);

  const {
    ref: focusRef,
    focusKey,
    focusSelf,
  } = useFocusable({
    focusable: true,
    trackChildren: true,
    isFocusBoundary: true,
    preferredChildFocusKey: streamLoading
      ? "PLAYER_LOADING_BACK"
      : "TV_SERVER_0",
  });

  useEffect(() => {
    const timer = setTimeout(() => focusSelf(), 50);
    return () => clearTimeout(timer);
  }, [focusSelf, streamLoading, streamError]);

  useEffect(() => {
    // Save to watch history when opened
    if (state.primaryTitle && !state.doNotTrack) {
      addItem({
        id:
          activeEpisode?.sourceLink || activeEpisode?.id || activeEpisode?.link,
        title: state.primaryTitle,
        poster: state.poster?.poster || state.poster?.background || "",
        background: state.poster?.background,
        link: state.infoUrl || "",
        provider: state.providerValue || "",
        lastPlayed: Date.now(),
        playbackRate: 1,
        episodeTitle: state.secondaryTitle,
        episode: activeEpisode,
        type: state.type,
      });
    }
  }, [state, activeEpisode?.link, addItem]);

  const handlePlayNative = useCallback(
    async (stream: any) => {
      if (!stream?.link) return;
      setIsLaunching(true);
      try {
        let playUrl = stream.link;

        if (isTorrentUrl(playUrl)) {
          try {
            playUrl = await resolveTorrentStreamUrl(playUrl);
          } catch (e) {
            console.error(
              "Failed to resolve torrent stream for external player",
              e,
            );
          }
        }

        if (isAndroid) {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          const headers = stream.headers ? JSON.stringify(stream.headers) : "";
          const external = useExternalPlayer ? "&external=1" : "";
          const intentUrl = `vega://play?url=${encodeURIComponent(playUrl)}&headers=${encodeURIComponent(headers)}${external}`;
          await openUrl(intentUrl);
        } else if (useVlc) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("open_external_player", {
            url: playUrl,
            playerPath: settingsStorage.getVlcPath(),
            headers: stream.headers || null,
          });
        }
      } catch (e) {
        console.error("Failed to open player", e);
      } finally {
        // Keep loader visible for a couple seconds to cover the external player's startup time
        setTimeout(() => setIsLaunching(false), 2000);
      }
    },
    [isAndroid, useExternalPlayer, useVlc],
  );

  if (streamLoading) {
    return (
      <FocusContext.Provider value={focusKey}>
        <div
          ref={focusRef}
          className="player-page controls-visible"
          style={{
            backgroundImage: `url(${state.poster?.background})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div
            className="player-page-overlay"
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.92)",
            }}
          />
          <FocusableButton
            className="player-loading-back"
            focusKey="PLAYER_LOADING_BACK"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <ArrowLeft size={23} />
          </FocusableButton>
          <div className="player-loading" style={{ background: "transparent" }}>
            <AnimatedHourglass sandColor={hourglassSandColor} />
            <span className="loading-text">Fetching Stream...</span>
          </div>
        </div>
      </FocusContext.Provider>
    );
  }

  if (streamError) {
    const bgUrl = state.poster?.background || state.poster?.poster;
    return (
      <div
        className="player-page controls-visible"
        style={{
          backgroundImage: bgUrl ? `url(${bgUrl})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {bgUrl && (
          <div
            className="player-page-overlay"
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.85)",
            }}
          />
        )}
        <div
          className="player-error"
          style={{ background: bgUrl ? "transparent" : "#000", zIndex: 1 }}
        >
          <p>{streamError.message || "Failed to load stream"}</p>
          <FocusableButton
            className="action-btn primary-btn"
            onClick={() => navigate(-1)}
          >
            Go Back
          </FocusableButton>
        </div>
      </div>
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={focusRef}
        className="tv-server-selection"
        style={{
          backgroundImage: `url(${state.poster?.background || state.poster?.poster})`,
        }}
      >
        <div className="tv-server-backdrop" />

        <div className="tv-server-shell">
          <header className="tv-server-header">
            <FocusableButton
              focusKey="TV_SERVER_BACK"
              className="tv-server-back"
              onClick={() => navigate(-1)}
              aria-label="Go back"
            >
              <ArrowLeft size={24} />
            </FocusableButton>
            <div className="tv-server-title-copy">
              <span className="tv-server-eyebrow">
                {isAndroid
                  ? useExternalPlayer
                    ? "Open in external player"
                    : "Play in Vega"
                  : "Open in VLC"}
              </span>
              <h1>{state.primaryTitle}</h1>
              {activeEpisode?.title && <p>{activeEpisode.title}</p>}
            </div>
          </header>

          {isLaunching ? (
            <div className="tv-server-launching">
              <div className="loading-spinner" />
              <span>
                {isAndroid && useExternalPlayer
                  ? "Opening app chooser…"
                  : isAndroid
                    ? "Opening Vega player…"
                    : "Opening VLC…"}
              </span>
            </div>
          ) : (
            <section className="tv-server-panel">
              <div className="tv-server-panel-heading">
                <div className="tv-server-panel-icon">
                  <Server size={21} />
                </div>
                <div>
                  <h2>Server</h2>
                  <p>{streamData?.length || 0} available</p>
                </div>
              </div>

              <div className="tv-server-list">
                {streamData?.map((stream: any, idx: number) => (
                  <FocusableButton
                    key={stream.link + "-" + idx}
                    focusKey={"TV_SERVER_" + idx}
                    className={
                      "tv-server-card " +
                      (selectedStream?.link === stream.link ? "selected" : "")
                    }
                    onClick={() => {
                      setSelectedStream(stream);
                      handlePlayNative(stream);
                    }}
                  >
                    <span className="tv-server-play">
                      <Play size={20} />
                    </span>
                    <span className="tv-server-name">
                      {stream.server || "Server " + (idx + 1)}
                    </span>
                    {stream.quality && (
                      <span className="tv-server-quality">
                        {stream.quality}
                      </span>
                    )}
                    {(() => {
                      const rawTags: string[] = Array.isArray(stream.tags)
                        ? stream.tags
                        : typeof stream.tag === "string"
                          ? [stream.tag]
                          : [];
                      const tags = rawTags
                        .map((t) => (typeof t === "string" ? t.trim() : ""))
                        .filter(
                          (t) =>
                            Boolean(t) &&
                            t.toLowerCase() !==
                            stream.quality?.toString().trim().toLowerCase(),
                        );

                      return tags.map((t, tIdx) => (
                        <span key={tIdx} className="tv-server-quality">
                          {t.toUpperCase()}
                        </span>
                      ));
                    })()}
                    <ExternalLink className="tv-server-open-icon" size={19} />
                  </FocusableButton>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </FocusContext.Provider>
  );
};

const SidebarEpisodeItem = React.memo<{
  episode: any;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  itemRef?: React.Ref<HTMLButtonElement>;
  focusable?: boolean;
}>(({ episode, index, isActive, onSelect, itemRef, focusable = true }) => {
  const epNum = index + 1;
  const title = episode?.title || `Episode ${epNum}`;
  const description = episode?.description?.trim();
  const rawImage = episode?.image || episode?.poster || episode?.still_path;
  const source =
    rawImage?.trim() && /^https?:\/\//i.test(rawImage) ? rawImage : undefined;
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => setImgFailed(false), [source]);

  return (
    <FocusableButton
      // @ts-ignore
      ref={itemRef}
      type="button"
      focusable={focusable}
      focusKey={`EPISODE_ITEM_${index}`}
      className={`player-episode-sidebar-item ${isActive ? "active" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <div
        className={`player-episode-sidebar-media ${source && !imgFailed ? "has-image" : ""}`}
      >
        {source && !imgFailed ? (
          <img
            src={source}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="player-episode-sidebar-media-placeholder">
            {epNum}
          </span>
        )}
        <div className="player-episode-sidebar-media-overlay">
          <Play size={18} fill={isActive ? "var(--primary)" : "#ffffff"} />
        </div>
      </div>
      <div className="player-episode-sidebar-item-info">
        <strong className="player-episode-sidebar-item-title">{title}</strong>
        {description && (
          <small className="player-episode-sidebar-item-desc">
            {description}
          </small>
        )}
      </div>
    </FocusableButton>
  );
});

const DesktopPlayer: React.FC<any> = ({
  state,
  activeEpisode,
  activeEpisodeIndex,
  setActiveEpisodeIndex,
  streamLoading,
  streamError,
  streamData,
  selectedStream,
  setSelectedStream,
  externalSubs,
  routeParams,
  hourglassSandColor,
}) => {
  const navigate = useNavigate();
  const { history, addItem, updatePlaybackInfo } = useWatchHistoryStore();
  const { provider } = useContentStore();

  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [isCropped, setIsCropped] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(() =>
    settingsStorage.getPlayerZoom(),
  );
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showEpisodeSidebar, setShowEpisodeSidebar] = useState(false);
  const activeEpisodeItemRef = useRef<HTMLButtonElement | null>(null);
  const showEpisodeSidebarSetting = settingsStorage.showPlayerEpisodeSidebar();
  const hasMultipleEpisodes =
    Array.isArray(state.episodeList) &&
    state.episodeList.length > 1 &&
    state.type !== "movie";
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const prevStreamLinkRef = useRef<string | null>(null);
  const appliedAudioForStreamRef = useRef<string | null>(null);
  const appliedSubtitleForStreamRef = useRef<string | null>(null);
  const failedStreamsRef = useRef<Set<string>>(new Set());
  const prePipStateRef = useRef<{ size: any; pos: any } | null>(null);
  const preFullscreenStateRef = useRef<{
    size: any;
    pos: any;
    maximized: boolean;
    alwaysOnTop: boolean;
  } | null>(null);
  const manualFullscreenRef = useRef(false);
  const prevVolumeRef = useRef<number>(100);
  const isWindows = navigator.userAgent.toLowerCase().includes("windows");
  const isAndroid = navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref: sidebarFocusRef, focusKey: sidebarFocusKey } = useFocusable({
    isFocusBoundary: true,
    trackChildren: true,
    focusKey: "PLAYER_EPISODES_SIDEBAR",
    focusable: showEpisodeSidebar && tvMode,
  });

  useEffect(() => {
    if (showEpisodeSidebar && tvMode) {
      const timer = setTimeout(() => {
        import("@noriginmedia/norigin-spatial-navigation-core")
          .then(({ setFocus, doesFocusableExist }) => {
            const key = `EPISODE_ITEM_${activeEpisodeIndex}`;
            if (doesFocusableExist(key)) {
              setFocus(key);
            }
          })
          .catch(() => { });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [showEpisodeSidebar, activeEpisodeIndex, tvMode]);

  const downloads = useDownloadStore((state) => state.downloads);

  const getCachedSkips = (keys: (string | undefined)[]): SkipInterval[] => {
    for (const key of keys) {
      if (!key) continue;
      try {
        const cached = cacheStorage.getString(`skips_${key}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch { }
    }
    return [];
  };

  const cacheSkips = (keys: (string | undefined)[], skips: SkipInterval[]) => {
    if (!skips || skips.length === 0) return;
    const serialized = JSON.stringify(skips);
    for (const key of keys) {
      if (!key) continue;
      try {
        cacheStorage.setString(`skips_${key}`, serialized);
      } catch { }
    }
  };

  const combinedSkips: SkipInterval[] = useMemo(() => {
    const list: SkipInterval[] = [];
    const addSkips = (items?: SkipInterval[]) => {
      if (!items || !Array.isArray(items)) return;
      for (const item of items) {
        if (
          item &&
          typeof item.from === "number" &&
          typeof item.to === "number" &&
          item.to > item.from &&
          item.from >= 0
        ) {
          const exists = list.some(
            (s) =>
              Math.abs(s.from - item.from) < 1 &&
              Math.abs(s.to - item.to) < 1,
          );
          if (!exists) {
            list.push({
              title: item.title || "Intro",
              from: item.from,
              to: item.to,
            });
          }
        }
      }
    };

    addSkips(activeEpisode?.skip);
    addSkips(activeEpisode?.skips);
    addSkips(selectedStream?.skip);
    addSkips(selectedStream?.skips);

    if (Array.isArray(state?.linkList)) {
      for (const linkGroup of state.linkList) {
        if (Array.isArray(linkGroup?.directLinks)) {
          const match = linkGroup.directLinks.find(
            (d: any) => d?.link === activeEpisode?.link,
          );
          if (match) {
            addSkips(match.skip);
          }
        }
      }
    }

    // Check downloadStore for matching download item with skip intervals
    const allDownloadsList = Object.values(downloads);
    const matchedDownload = allDownloadsList.find(
      (d) =>
        (activeEpisode?.id && d.id === activeEpisode.id) ||
        (activeEpisode?.link &&
          (d.filePath === activeEpisode.link ||
            d.url === activeEpisode.link ||
            d.sourceLink === activeEpisode.link)) ||
        (activeEpisode?.sourceLink &&
          (d.sourceLink === activeEpisode.sourceLink ||
            d.url === activeEpisode.sourceLink ||
            d.filePath === activeEpisode.sourceLink)) ||
        (selectedStream?.link &&
          (d.filePath === selectedStream.link ||
            d.url === selectedStream.link)),
    );
    if (matchedDownload?.skip) {
      addSkips(matchedDownload.skip);
    }

    // Check cacheStorage if no skips found yet
    const episodeCacheKey =
      activeEpisode?.link ||
      activeEpisode?.sourceLink ||
      activeEpisode?.id ||
      (state?.infoUrl && activeEpisode?.title
        ? `${state.infoUrl}:${activeEpisode.title}`
        : undefined);

    if (list.length === 0) {
      const cached = getCachedSkips([
        activeEpisode?.link,
        activeEpisode?.sourceLink,
        activeEpisode?.id,
        episodeCacheKey,
      ]);
      addSkips(cached);
    }

    const sorted = list.sort((a, b) => a.from - b.from);

    // Save to cache for future offline / download playback if skips exist
    if (sorted.length > 0) {
      cacheSkips(
        [
          activeEpisode?.link,
          activeEpisode?.sourceLink,
          activeEpisode?.id,
          episodeCacheKey,
        ],
        sorted,
      );
    }

    return sorted;
  }, [activeEpisode, downloads, selectedStream, state?.infoUrl, state?.linkList]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("player-window-fullscreen", isFullscreen);
    return () => document.body.classList.remove("player-window-fullscreen");
  }, [isFullscreen]);

  useEffect(() => {
    document.body.classList.toggle("player-window-pip", isPip);
    return () => document.body.classList.remove("player-window-pip");
  }, [isPip]);

  useEffect(() => {
    document.body.classList.toggle("player-controls-hidden", !showControls);
    return () => document.body.classList.remove("player-controls-hidden");
  }, [showControls]);

  const toast = useCallback((msg: string, duration = 2200) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, duration);
  }, []);

  const openInVlc = useCallback(async () => {
    if (!selectedStream?.link) return;
    try {
      let playUrl = selectedStream.link;
      if (isTorrentUrl(playUrl)) {
        toast("Preparing torrent stream for VLC...");
        playUrl = await resolveTorrentStreamUrl(playUrl);
      }
      await invoke("open_external_player", {
        url: playUrl,
        playerPath: settingsStorage.getVlcPath(),
        headers: selectedStream.headers || null,
      });
      toast("Opened in VLC");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to open VLC:", error);
      window.alert(message);
    }
  }, [selectedStream, toast]);

  const copyStreamLink = useCallback(async () => {
    if (!selectedStream?.link) return;
    try {
      await navigator.clipboard.writeText(selectedStream.link);
      toast("Stream link copied");
    } catch (error) {
      console.error("Failed to copy stream link:", error);
      toast("Could not copy stream link");
    }
  }, [selectedStream?.link, toast]);

  const handleNextEpisode = useCallback(() => {
    if (activeEpisodeIndex < state.episodeList.length - 1) {
      prevStreamLinkRef.current = null;
      appliedAudioForStreamRef.current = null;
      appliedSubtitleForStreamRef.current = null;
      setActiveEpisodeIndex((prev: number) => prev + 1);
      toast("Playing next episode");
    }
  }, [
    activeEpisodeIndex,
    state.episodeList.length,
    toast,
    setActiveEpisodeIndex,
  ]);

  const handlePrevEpisode = useCallback(() => {
    if (activeEpisodeIndex > 0) {
      prevStreamLinkRef.current = null;
      appliedAudioForStreamRef.current = null;
      appliedSubtitleForStreamRef.current = null;
      setActiveEpisodeIndex((prev: number) => prev - 1);
      toast("Playing previous episode");
    }
  }, [activeEpisodeIndex, toast, setActiveEpisodeIndex]);

  useEffect(() => {
    failedStreamsRef.current.clear();
  }, [
    activeEpisodeIndex,
    state.primaryTitle,
    activeEpisode?.id,
    activeEpisode?.link,
  ]);

  const getServerName = useCallback((stream: any, index?: number) => {
    if (!stream) return "Server";
    if (stream.server) return stream.server;
    if (stream.quality) return `Server (${stream.quality})`;
    if (typeof index === "number" && index >= 0) return `Server ${index + 1}`;
    return "Server";
  }, []);

  const handleStreamSelect = useCallback(
    (stream: any, isManual = false) => {
      if (isManual && stream?.link) {
        failedStreamsRef.current.delete(stream.link);
      }
      prevStreamLinkRef.current = null;
      appliedAudioForStreamRef.current = null;
      appliedSubtitleForStreamRef.current = null;
      setSelectedStream(stream);
    },
    [setSelectedStream],
  );

  const handlePlaybackError = useCallback(
    (errorMsg: string) => {
      console.warn("[PlayerPage] Playback error encountered:", errorMsg);
      setShowControls(true);

      const currentLink = selectedStream?.link;
      if (currentLink) {
        if (failedStreamsRef.current.has(currentLink)) {
          return;
        }
        failedStreamsRef.current.add(currentLink);
      }

      const currentStreams = Array.isArray(streamData) ? streamData : [];
      const currentIndex = currentStreams.findIndex(
        (s: any) => s?.link === currentLink,
      );
      const currentName = getServerName(
        selectedStream,
        currentIndex >= 0 ? currentIndex : undefined,
      );

      let nextStream: any = null;
      let nextIndex = -1;

      for (let i = currentIndex + 1; i < currentStreams.length; i++) {
        if (
          currentStreams[i]?.link &&
          !failedStreamsRef.current.has(currentStreams[i].link)
        ) {
          nextStream = currentStreams[i];
          nextIndex = i;
          break;
        }
      }

      if (!nextStream) {
        for (let i = 0; i < currentIndex; i++) {
          if (
            currentStreams[i]?.link &&
            !failedStreamsRef.current.has(currentStreams[i].link)
          ) {
            nextStream = currentStreams[i];
            nextIndex = i;
            break;
          }
        }
      }

      if (nextStream) {
        const nextName = getServerName(nextStream, nextIndex);
        toast(`Failed to play ${currentName}. Switching to ${nextName}...`, 2800);
        handleStreamSelect(nextStream, false);
      } else {
        if (currentStreams.length > 1) {
          toast(
            "Playback failed on all available servers. Please select another server or source.",
            3500,
          );
        } else {
          toast(
            `Playback failed on ${currentName}. Please select another server or source.`,
            3500,
          );
        }
      }
    },
    [selectedStream, streamData, getServerName, toast, handleStreamSelect],
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mpv = usePlayerEngine(videoRef, {
    onError: handlePlaybackError,
    onFileLoaded: () => {
      const historyKey =
        activeEpisode?.sourceLink || activeEpisode?.id || activeEpisode?.link;
      const syncedProgress = history.find(
        (item) => item.id === historyKey,
      )?.progress;
      if (syncedProgress !== undefined) {
        if (syncedProgress > 5) mpv.seek(syncedProgress);
        return;
      }
      const uniqueEpisodeKey =
        activeEpisode?.id ||
        `resume_${routeParams?.primaryTitle}_${routeParams?.secondaryTitle}_${activeEpisodeIndex}`;
      const cached = cacheStorage.getString(uniqueEpisodeKey);
      if (cached) {
        try {
          const { position } = JSON.parse(cached);
          if (position > 5) mpv.seek(position);
        } catch { }
      }
    },
  });

  const { handleProgress } = usePlayerProgress({
    activeEpisode,
    routeParams,
    playbackRate,
    updatePlaybackInfo,
  });

  const mediaArtwork = useMemo(
    () =>
      [state.poster?.poster, state.poster?.background].filter(
        (source): source is string => Boolean(source),
      ),
    [state.poster?.background, state.poster?.poster],
  );
  const handleMediaSeekRelative = useCallback(
    (offset: number) => mpv.seek(offset, "relative"),
    [mpv.seek],
  );

  useMediaSession({
    enabled: mpv.isInitialized && Boolean(selectedStream?.link),
    title:
      state.type === "series"
        ? activeEpisode?.title || state.primaryTitle
        : state.primaryTitle,
    artist: state.type === "series" ? state.primaryTitle : "Vega",
    album: state.secondaryTitle,
    artwork: mediaArtwork,
    isPaused: mpv.isPaused,
    currentTime: mpv.currentTime,
    duration: mpv.duration,
    playbackRate,
    onTogglePause: mpv.togglePause,
    onSeek: mpv.seek,
    onSeekRelative: handleMediaSeekRelative,
    onNext:
      activeEpisodeIndex < state.episodeList.length - 1
        ? handleNextEpisode
        : undefined,
    onPrevious: activeEpisodeIndex > 0 ? handlePrevEpisode : undefined,
  });

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const root = document.getElementById("root");
    if (root) root.style.background = "transparent";
    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
      if (root) root.style.background = "";
      const win = getCurrentWindow();
      const previousState = preFullscreenStateRef.current;
      void (async () => {
        await win.setFullscreen(false).catch(() => { });
        if (previousState) {
          await win.setAlwaysOnTop(previousState.alwaysOnTop).catch(() => { });
          if (previousState.maximized) {
            await win.maximize().catch(() => { });
            await invoke("ensure_window_in_work_area", {
              maximized: true,
            }).catch(() => { });
          } else if (manualFullscreenRef.current) {
            await win.setPosition(previousState.pos).catch(() => { });
            await win.setSize(previousState.size).catch(() => { });
          }
        }
        manualFullscreenRef.current = false;
        preFullscreenStateRef.current = null;
      })();
    };
  }, []);

  useEffect(() => {
    mpv.initPlayer();
    return () => {
      mpv.destroyPlayer();
    };
  }, []);

  useEffect(() => {
    if (mpv.isInitialized) {
      mpv.updateSubtitleSettings();
      const savedZoom = settingsStorage.getPlayerZoom();
      if (savedZoom !== 100) {
        mpv.setProperty("video-zoom", Math.log2(savedZoom / 100));
      }
    }

    const handleSubSettingsChanged = () => {
      if (mpv.isInitialized) {
        mpv.updateSubtitleSettings();
      }
    };
    window.addEventListener("vega_subtitle_settings_changed", handleSubSettingsChanged);
    return () => {
      window.removeEventListener("vega_subtitle_settings_changed", handleSubSettingsChanged);
    };
  }, [mpv.isInitialized]);

  // Apply saved audio and subtitle track preferences once per new stream/episode
  useEffect(() => {
    if (!mpv.isInitialized || !selectedStream?.link) return;
    const streamLink = selectedStream.link;

    // 1. Audio track matching
    if (
      appliedAudioForStreamRef.current !== streamLink &&
      mpv.audioTracks.length > 0
    ) {
      const saved = getSavedTrackPreference(state);
      if (saved) {
        const targetAudio = findBestMatchingAudioTrack(mpv.audioTracks, saved);
        if (targetAudio) {
          appliedAudioForStreamRef.current = streamLink;
          if (!targetAudio.selected) {
            mpv.selectTrack("aid", targetAudio.id);
          }
        }
      }
    }

    // 2. Subtitle track matching
    const saved = getSavedTrackPreference(state);
    const hasSelectedSub = mpv.subtitleTracks.some((t) => t.selected);
    const shouldMatchSub =
      (appliedSubtitleForStreamRef.current !== streamLink || !hasSelectedSub) &&
      mpv.subtitleTracks.length > 0;

    if (shouldMatchSub) {
      if (saved) {
        if (saved.subOff) {
          appliedSubtitleForStreamRef.current = streamLink;
          if (hasSelectedSub) {
            mpv.selectTrack("sid", "no");
          }
        } else {
          const targetSub = findBestMatchingSubtitleTrack(
            mpv.subtitleTracks,
            saved,
          );
          if (targetSub) {
            appliedSubtitleForStreamRef.current = streamLink;
            if (!targetSub.selected) {
              mpv.selectTrack("sid", targetSub.id);
            }
          }
        }
      } else {
        const downloadedTrack = mpv.subtitleTracks.find((t) => {
          const title = t.title?.toLowerCase() || "";
          return title.includes("downloaded") || title.includes("local");
        });
        if (downloadedTrack) {
          appliedSubtitleForStreamRef.current = streamLink;
          if (!downloadedTrack.selected) {
            mpv.selectTrack("sid", downloadedTrack.id);
          }
        } else {
          const defaultTrack =
            mpv.subtitleTracks.find(
              (t) => (t as any).is_default && !(t as any).isBitmapSub,
            ) ||
            mpv.subtitleTracks.find((t) => {
              if ((t as any).isBitmapSub) return false;
              const lang = (t.lang || "").toLowerCase();
              const title = (t.title || "").toLowerCase();
              return (
                lang.startsWith("en") ||
                title.includes("english") ||
                title.includes("eng")
              );
            }) ||
            mpv.subtitleTracks.find((t) => !(t as any).isBitmapSub);

          if (defaultTrack) {
            appliedSubtitleForStreamRef.current = streamLink;
            if (!defaultTrack.selected) {
              mpv.selectTrack("sid", defaultTrack.id);
            }
          }
        }
      }
    }
  }, [
    mpv.audioTracks,
    mpv.subtitleTracks,
    selectedStream?.link,
    mpv.isInitialized,
    state,
  ]);

  // Sync external subtitles dynamically as they resolve
  useEffect(() => {
    if (!mpv.isInitialized) return;
    const allSubs = [
      ...(selectedStream?.subtitles || []),
      ...(externalSubs || []),
    ];
    const seen = new Set<string>();
    const subs = allSubs.filter((sub) => {
      const url = sub.url || sub.uri;
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    if (subs.length > 0) {
      mpv.setExternalSubtitles?.(subs);
    }
  }, [
    mpv.isInitialized,
    selectedStream?.subtitles,
    externalSubs,
    mpv.setExternalSubtitles,
  ]);

  useEffect(() => {
    if (!mpv.isInitialized || !selectedStream?.link) return;
    if (prevStreamLinkRef.current === selectedStream.link) return;
    prevStreamLinkRef.current = selectedStream.link;

    (async () => {
      const allSubs = [
        ...(selectedStream.subtitles || []),
        ...(externalSubs || []),
      ];
      const seen = new Set<string>();
      const subs = allSubs.filter((sub) => {
        const url = sub.url || sub.uri;
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      });
      try {
        if (isTorrentUrl(selectedStream.link)) {
          toast("Connecting to torrent...", 3500);
        }
        await mpv.loadFile(
          selectedStream.link,
          selectedStream.headers,
          subs,
          selectedStream.type,
          selectedStream.localBaseDir,
        );
      } catch (err: any) {
        console.error("loadFile failed:", err);
        handlePlaybackError(err?.message || "Failed to load stream");
      }
    })();
  }, [
    mpv.isInitialized,
    selectedStream?.link,
    selectedStream?.headers,
    selectedStream?.subtitles,
    selectedStream?.type,
    selectedStream?.localBaseDir,
    externalSubs,
    mpv.loadFile,
    handlePlaybackError,
  ]);

  useEffect(() => {
    if (mpv.currentTime > 0 && mpv.duration > 0) {
      handleProgress({
        currentTime: mpv.currentTime,
        seekableDuration: mpv.duration,
      });
    }
  }, [Math.floor(mpv.currentTime)]);

  useEffect(() => {
    if (!state.primaryTitle || state.doNotTrack) return;
    addItem({
      id: activeEpisode?.sourceLink || activeEpisode?.id || activeEpisode?.link,
      title: state.primaryTitle,
      poster: state.poster?.poster || state.poster?.background || "",
      background: state.poster?.background,
      link: state.infoUrl || "",
      provider: state.providerValue || provider?.value || "",
      lastPlayed: Date.now(),
      playbackRate: 1,
      episodeTitle: activeEpisode?.title || state.secondaryTitle,
      episode: activeEpisode,
      type: state.type,
    });
  }, [
    state,
    activeEpisode?.id,
    activeEpisode?.link,
    activeEpisode?.title,
    addItem,
    provider?.value,
  ]);

  const hideControls = useCallback(() => {
    if (
      !showShortcuts &&
      !showEpisodeSidebar &&
      !isScrubbingRef.current &&
      !mpv.playbackError
    ) {
      setShowControls(false);
    }
  }, [showShortcuts, showEpisodeSidebar, mpv.playbackError]);
  const scheduleHide = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (mpv.playbackError) return;
    controlsTimerRef.current = window.setTimeout(hideControls, 3500);
  }, [hideControls, mpv.playbackError]);

  useEffect(() => {
    if (showEpisodeSidebar) {
      const timer = window.setTimeout(() => {
        activeEpisodeItemRef.current?.scrollIntoView({
          behavior: "auto",
          block: "nearest",
        });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [showEpisodeSidebar]);

  const revealControls = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    const handleToggleEpisodes = () => {
      if (hasMultipleEpisodes) {
        setShowEpisodeSidebar((prev) => !prev);
        revealControls();
      }
    };
    const handleRemoteActivity = () => {
      revealControls();
    };
    window.addEventListener("vega:toggle-episodes", handleToggleEpisodes);
    window.addEventListener("vega:remote-activity", handleRemoteActivity);
    return () => {
      window.removeEventListener("vega:toggle-episodes", handleToggleEpisodes);
      window.removeEventListener("vega:remote-activity", handleRemoteActivity);
    };
  }, [hasMultipleEpisodes, revealControls]);

  useEffect(() => {
    if (showControls) scheduleHide();
  }, [showControls, scheduleHide]);

  const handleMouseMove = useCallback(() => revealControls(), [revealControls]);
  const handleBackgroundClick = useCallback(() => {
    if (showControls) {
      setShowControls(false);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    } else {
      revealControls();
    }
  }, [showControls, revealControls]);

  const applyZoom = useCallback(
    (newZoom: number) => {
      const clamped = Math.min(300, Math.max(50, Math.round(newZoom)));
      setZoomLevel(clamped);
      settingsStorage.setPlayerZoom(clamped);
      const mpvZoom = clamped === 100 ? 0.0 : Math.log2(clamped / 100);
      mpv.setProperty("video-zoom", mpvZoom);
      toast(`Zoom: ${clamped}%${clamped === 100 ? " (Default)" : ""}`);
    },
    [mpv, toast],
  );

  const handleZoomIn = useCallback(() => {
    applyZoom(zoomLevel + 10);
  }, [applyZoom, zoomLevel]);

  const handleZoomOut = useCallback(() => {
    applyZoom(zoomLevel - 10);
  }, [applyZoom, zoomLevel]);

  const handleResetZoom = useCallback(() => {
    applyZoom(100);
  }, [applyZoom]);

  const toggleFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    try {
      const nativeFullscreen = await win.isFullscreen();
      const currentlyFullscreen =
        nativeFullscreen || manualFullscreenRef.current;

      if (currentlyFullscreen) {
        const previousState = preFullscreenStateRef.current;
        if (nativeFullscreen) await win.setFullscreen(false);
        await win.setAlwaysOnTop(previousState?.alwaysOnTop ?? false);

        if (previousState?.maximized) {
          if (!(await win.isMaximized())) await win.maximize();
          await invoke("ensure_window_in_work_area", { maximized: true });
        } else if (manualFullscreenRef.current && previousState) {
          await win.setPosition(previousState.pos);
          await win.setSize(previousState.size);
        }

        manualFullscreenRef.current = false;
        preFullscreenStateRef.current = null;
        setIsFullscreen(false);
        return;
      }

      preFullscreenStateRef.current = {
        size: await win.outerSize(),
        pos: await win.outerPosition(),
        maximized: await win.isMaximized(),
        alwaysOnTop: await win.isAlwaysOnTop(),
      };

      if (isWindows) {
        await invoke("set_player_fullscreen", { fullscreen: true });
      } else {
        await win.setFullscreen(true);
      }

      const monitor = await currentMonitor();
      const actualFullscreen = await win.isFullscreen();

      if (!actualFullscreen) {
        if (!monitor) throw new Error("Unable to determine the active monitor");
        if (await win.isMaximized()) await win.unmaximize();
        await win.setDecorations(false);
        await win.setPosition(monitor.position);
        await win.setSize(monitor.size);
        await win.setAlwaysOnTop(true);
        manualFullscreenRef.current = true;
      } else {
        await win.setAlwaysOnTop(true);
      }

      setIsFullscreen(true);
    } catch (e) {
      console.error(e);
      const previousState = preFullscreenStateRef.current;
      await win.setFullscreen(false).catch(() => { });
      await win
        .setAlwaysOnTop(previousState?.alwaysOnTop ?? false)
        .catch(() => { });
      if (previousState?.maximized) {
        await win.maximize().catch(() => { });
        await invoke("ensure_window_in_work_area", { maximized: true }).catch(
          () => { },
        );
      } else if (previousState) {
        await win.setPosition(previousState.pos).catch(() => { });
        await win.setSize(previousState.size).catch(() => { });
      }
      manualFullscreenRef.current = false;
      preFullscreenStateRef.current = null;
      setIsFullscreen(false);
    }
  }, [isWindows]);

  const togglePip = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const currentPip = await win.isAlwaysOnTop();
      const nextPip = !currentPip;
      if (nextPip) {
        const size = await win.innerSize();
        const pos = await win.outerPosition();
        prePipStateRef.current = { size, pos };
      }
      await win.setAlwaysOnTop(nextPip);
      await win.setDecorations(false);
      setIsPip(nextPip);
      if (nextPip) {
        const monitor = await currentMonitor();
        await win.setSize(new LogicalSize(480, 270));
        if (monitor) {
          const pipSize = await win.outerSize();
          const margin = Math.round(16 * monitor.scaleFactor);
          await win.setPosition(
            new PhysicalPosition(
              Math.max(
                monitor.position.x,
                monitor.position.x +
                monitor.size.width -
                pipSize.width -
                margin,
              ),
              Math.max(
                monitor.position.y,
                monitor.position.y +
                monitor.size.height -
                pipSize.height -
                margin,
              ),
            ),
          );
          if (isWindows) {
            await invoke("ensure_window_in_work_area", { maximized: false });
          }
        }
      } else {
        if (prePipStateRef.current) {
          await win.setSize(prePipStateRef.current.size);
          await win.setPosition(prePipStateRef.current.pos);
        } else {
          await win.setSize(new LogicalSize(1280, 720));
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [isWindows]);

  const toggleCrop = useCallback(() => {
    setIsCropped((prev) => {
      const nextCrop = !prev;
      mpv.setProperty("panscan", nextCrop ? 1.0 : 0.0);
      return nextCrop;
    });
  }, [mpv]);

  const mpvRef = useRef(mpv);
  mpvRef.current = mpv;
  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;
  const showControlsRef = useRef(showControls);
  showControlsRef.current = showControls;
  const showEpisodeSidebarRef = useRef(showEpisodeSidebar);
  showEpisodeSidebarRef.current = showEpisodeSidebar;
  const showShortcutsRef = useRef(showShortcuts);
  showShortcutsRef.current = showShortcuts;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const combinedSkipsRef = useRef(combinedSkips);
  combinedSkipsRef.current = combinedSkips;
  const selectedStreamRef = useRef(selectedStream);
  selectedStreamRef.current = selectedStream;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    window.focus();
  }, []);

  useEffect(() => {
    // Keep spatial navigation running so directional remote/controller navigation works!
    import("@noriginmedia/norigin-spatial-navigation-core")
      .then(({ resume }) => resume())
      .catch(() => { });

    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          ".inline-menu, .inline-menu-container, .player-shortcuts-overlay, .player-shortcuts-dialog, .search-subtitles-modal, .search-subtitles-container, .player-episode-sidebar, .player-episode-sidebar-list, [data-prevent-wheel-volume]",
        )
      ) {
        return;
      }
      revealControls();
      const currentVol = mpvRef.current.volume;
      const newVol =
        e.deltaY < 0
          ? Math.min(200, currentVol + 5)
          : Math.max(0, currentVol - 5);
      mpvRef.current.setVolumeLevel(newVol);
      toast(`Volume: ${Math.round(newVol)}%`);
    };

    const onMouseMoveEvent = () => revealControls();
    const onTouch = () => revealControls();

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      const key = e.key.toLowerCase();

      // Avoid swallowing devtools or system shortcuts
      if (key === "f12") return;
      if ((e.ctrlKey || e.metaKey || e.altKey) && key !== "s") {
        return;
      }

      // Remote media keys
      if (key === "mediaplaypause") {
        e.preventDefault();
        mpvRef.current.togglePause();
        revealControls();
        return;
      }
      if (key === "mediaplay") {
        e.preventDefault();
        if (mpvRef.current.isPaused) mpvRef.current.togglePause();
        revealControls();
        return;
      }
      if (key === "mediapause") {
        e.preventDefault();
        if (!mpvRef.current.isPaused) mpvRef.current.togglePause();
        revealControls();
        return;
      }
      if (key === "mediafastforward") {
        e.preventDefault();
        mpvRef.current.seek(10, "relative");
        toast("+10s");
        revealControls();
        return;
      }
      if (key === "mediarewind") {
        e.preventDefault();
        mpvRef.current.seek(-10, "relative");
        toast("-10s");
        revealControls();
        return;
      }
      if (key === "mediatracknext") {
        e.preventDefault();
        handleNextEpisode();
        return;
      }
      if (key === "mediatrackprevious") {
        e.preventDefault();
        handlePrevEpisode();
        return;
      }
      if (key === "mediastop") {
        e.preventDefault();
        navigate(-1);
        return;
      }

      // Remote back key (Escape, Back, BrowserBack, Android keycode 4)
      if (
        key === "escape" ||
        key === "back" ||
        key === "browserback" ||
        e.keyCode === 27 ||
        e.keyCode === 10009
      ) {
        e.preventDefault();
        if (showEpisodeSidebarRef.current) setShowEpisodeSidebar(false);
        else if (showShortcutsRef.current) setShowShortcuts(false);
        else if (showControlsRef.current) setShowControls(false);
        else if (isFullscreenRef.current) toggleFullscreen();
        else navigate(-1);
        return;
      }

      switch (key) {
        case " ":
        case "k": {
          e.preventDefault();
          if (target?.tagName === "BUTTON") {
            target.blur();
          }
          mpvRef.current.togglePause();
          revealControls();
          break;
        }
        case "arrowleft":
        case "j": {
          if (tvMode && showControlsRef.current && key === "arrowleft") break;
          e.preventDefault();
          mpvRef.current.seek(-10, "relative");
          toast("-10s");
          revealControls();
          break;
        }
        case "arrowright":
        case "l": {
          if (tvMode && showControlsRef.current && key === "arrowright") break;
          e.preventDefault();
          mpvRef.current.seek(10, "relative");
          toast("+10s");
          revealControls();
          break;
        }
        case "arrowup": {
          if (tvMode && showControlsRef.current) break;
          e.preventDefault();
          const curVol = mpvRef.current.volume;
          const newVol = Math.min(200, curVol + 5);
          mpvRef.current.setVolumeLevel(newVol);
          toast(`Volume: ${Math.round(newVol)}%`);
          revealControls();
          break;
        }
        case "arrowdown": {
          if (tvMode && showControlsRef.current) break;
          e.preventDefault();
          const curVol = mpvRef.current.volume;
          const newVol = Math.max(0, curVol - 5);
          mpvRef.current.setVolumeLevel(newVol);
          toast(`Volume: ${Math.round(newVol)}%`);
          revealControls();
          break;
        }
        case "enter": {
          if (!showControlsRef.current) {
            e.preventDefault();
            mpvRef.current.togglePause();
            revealControls();
          }
          break;
        }
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "i":
          e.preventDefault();
          togglePip();
          break;
        case "m": {
          e.preventDefault();
          if (mpvRef.current.volume > 0) {
            prevVolumeRef.current = mpvRef.current.volume;
            mpvRef.current.setVolumeLevel(0);
            toast("Muted");
          } else {
            const restoreVol =
              prevVolumeRef.current > 0 ? prevVolumeRef.current : 100;
            mpvRef.current.setVolumeLevel(restoreVol);
            toast(`Volume: ${Math.round(restoreVol)}%`);
          }
          revealControls();
          break;
        }
        case "n":
          e.preventDefault();
          handleNextEpisode();
          break;
        case "p":
          e.preventDefault();
          handlePrevEpisode();
          break;
        case "a": {
          const aTracks = mpvRef.current.audioTracks || [];
          if (!aTracks.length) break;
          e.preventDefault();
          appliedAudioForStreamRef.current =
            selectedStreamRef.current?.link || null;
          const selectedIndex = aTracks.findIndex((track) => track.selected);
          const nextIndex = (selectedIndex + 1) % aTracks.length;
          const nextTrack = aTracks[nextIndex];
          mpvRef.current.selectTrack("aid", nextTrack.id);
          saveAudioPreference(stateRef.current, nextTrack, nextIndex);
          toast(`Audio: ${formatTrackLabel(nextTrack)}`);
          revealControls();
          break;
        }
        case "z":
        case "[": {
          e.preventDefault();
          const step = e.shiftKey ? 250 : 50;
          const newDelay = (mpvRef.current.audioDelay || 0) - step;
          mpvRef.current.setAudioDelay?.(newDelay);
          toast(`Audio Sync: ${newDelay > 0 ? `+${newDelay}` : newDelay}ms`);
          revealControls();
          break;
        }
        case "x":
        case "]": {
          e.preventDefault();
          const step = e.shiftKey ? 250 : 50;
          const newDelay = (mpvRef.current.audioDelay || 0) + step;
          mpvRef.current.setAudioDelay?.(newDelay);
          toast(`Audio Sync: ${newDelay > 0 ? `+${newDelay}` : newDelay}ms`);
          revealControls();
          break;
        }
        case "c":
        case "t": {
          e.preventDefault();
          appliedSubtitleForStreamRef.current =
            selectedStreamRef.current?.link || null;
          const subTracks = mpvRef.current.subtitleTracks || [];
          const selectedIndex = subTracks.findIndex((track) => track.selected);
          if (!subTracks.length || selectedIndex === subTracks.length - 1) {
            mpvRef.current.selectTrack("sid", "no");
            saveSubtitlePreference(stateRef.current, "off");
            toast("Subtitles: Off");
          } else {
            const nextIndex = selectedIndex + 1;
            const nextTrack = subTracks[nextIndex];
            mpvRef.current.selectTrack("sid", nextTrack.id);
            saveSubtitlePreference(stateRef.current, nextTrack, nextIndex);
            toast(`Subtitles: ${formatTrackLabel(nextTrack)}`);
          }
          revealControls();
          break;
        }
        case "g": {
          e.preventDefault();
          const step = e.shiftKey ? 250 : 50;
          const newDelay = (mpvRef.current.subtitleDelay || 0) - step;
          mpvRef.current.setSubtitleDelay?.(newDelay);
          toast(`Subtitle Sync: ${newDelay > 0 ? `+${newDelay}` : newDelay}ms`);
          revealControls();
          break;
        }
        case "h": {
          e.preventDefault();
          const step = e.shiftKey ? 250 : 50;
          const newDelay = (mpvRef.current.subtitleDelay || 0) + step;
          mpvRef.current.setSubtitleDelay?.(newDelay);
          toast(`Subtitle Sync: ${newDelay > 0 ? `+${newDelay}` : newDelay}ms`);
          revealControls();
          break;
        }
        case "<":
        case ">": {
          e.preventDefault();
          const step = key === "<" ? -0.25 : 0.25;
          const nextRate = Math.min(
            4,
            Math.max(
              0.25,
              Math.round((playbackRateRef.current + step) * 100) / 100,
            ),
          );
          setPlaybackRate(nextRate);
          mpvRef.current.setPlaybackSpeed(nextRate);
          toast(`Speed: ${nextRate.toFixed(2)}x`);
          revealControls();
          break;
        }
        case "s": {
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            const chs = mpvRef.current.chapters || [];
            const curTime = mpvRef.current.currentTime;
            const nextChapter = chs.find(
              (chapter) => chapter.time > curTime + 1,
            );
            if (nextChapter) {
              mpvRef.current.seek(nextChapter.time);
              toast(`Chapter: ${nextChapter.title || "Next"}`);
            } else {
              toast("No next chapter");
            }
          } else {
            const curTime = mpvRef.current.currentTime;
            const activeSkip = combinedSkipsRef.current?.find(
              (skip) => curTime >= skip.from && curTime < skip.to,
            );
            if (activeSkip) {
              mpvRef.current.seek(activeSkip.to);
              const title = activeSkip.title
                ? activeSkip.title.toLowerCase().startsWith("skip")
                  ? activeSkip.title
                  : `Skip ${activeSkip.title}`
                : "Intro";
              toast(`Skipped ${title}`);
            } else {
              toast("No intro to skip");
            }
          }
          revealControls();
          break;
        }
        case "+":
        case "=":
          e.preventDefault();
          handleZoomIn();
          break;
        case "-":
        case "_":
          e.preventDefault();
          handleZoomOut();
          break;
        case "0":
          e.preventDefault();
          handleResetZoom();
          break;
        case "?":
          e.preventDefault();
          setShowShortcuts((current) => !current);
          break;
      }
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("mousemove", onMouseMoveEvent);
    window.addEventListener("touchstart", onTouch);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("mousemove", onMouseMoveEvent);
      window.removeEventListener("touchstart", onTouch);
    };
  }, [
    handleNextEpisode,
    handlePrevEpisode,
    revealControls,
    toast,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    toggleFullscreen,
    togglePip,
    tvMode,
    navigate,
  ]);

  const showNextBtn = useMemo(() => {
    if (activeEpisodeIndex >= state.episodeList.length - 1) return false;
    if (mpv.duration <= 0) return false;
    return mpv.currentTime / mpv.duration > 0.8;
  }, [
    activeEpisodeIndex,
    mpv.currentTime,
    mpv.duration,
    state.episodeList.length,
  ]);
  const nextEpisodeTitle =
    state.episodeList[activeEpisodeIndex + 1]?.title ||
    (activeEpisodeIndex < state.episodeList.length - 1
      ? `Episode ${activeEpisodeIndex + 2}`
      : undefined);

  const bgUrl = state.poster?.background || state.poster?.poster;

  return (
    <div
      className={`player-page ${showControls ? "controls-visible" : ""}`}
      onMouseMove={handleMouseMove}
      style={{ backgroundColor: "#000" }}
      {...(isPip ? { "data-tauri-drag-region": true } : {})}
    >
      <div className="player-video-wrapper">
        <video
          ref={mpv.bindVideo}
          className={`player-video-element ${isCropped ? "cropped" : ""}`}
          style={{
            transform: zoomLevel !== 100 ? `scale(${zoomLevel / 100})` : undefined,
          }}
          playsInline
        />
      </div>

      {streamLoading && (
        <div
          className="player-page-overlay-loading"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 90,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: bgUrl ? "transparent" : "#000",
          }}
        >
          {bgUrl && (
            <>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundImage: `url(${bgUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  zIndex: -2,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundColor: "rgba(0,0,0,0.95)",
                  zIndex: -1,
                }}
              />
            </>
          )}
          <FocusableButton
            className="player-loading-back"
            focusKey="PLAYER_LOADING_BACK"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <ArrowLeft size={23} />
          </FocusableButton>
          <div
            className="player-loading"
            style={{ background: bgUrl ? "transparent" : "#000" }}
          >
            <AnimatedHourglass sandColor={hourglassSandColor} />
            <span className="loading-text">Fetching stream...</span>
          </div>
        </div>
      )}

      {streamError && !streamLoading && (!streamData || streamData.length === 0) && (
        <div
          className="player-page-overlay-error"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 91,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: bgUrl ? "transparent" : "#000",
          }}
        >
          {bgUrl && (
            <>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundImage: `url(${bgUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  zIndex: -2,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundColor: "rgba(0,0,0,0.95)",
                  zIndex: -1,
                }}
              />
            </>
          )}
          <div
            className="player-error"
            style={{ background: bgUrl ? "transparent" : "#000", zIndex: 1 }}
          >
            <p>{streamError.message || "Failed to load stream"}</p>
            <button onClick={() => navigate(-1)}>Go Back</button>
          </div>
        </div>
      )}

      {mpv.initializationError && !streamLoading && !streamError && (
        <div style={{ position: "absolute", inset: 0, zIndex: 92 }}>
          <PlayerInitError
            error={mpv.initializationError}
            onBack={() => navigate(-1)}
            onOpenVlc={selectedStream?.link ? openInVlc : undefined}
          />
        </div>
      )}
      <ControlsFocusProvider visible={showControls && !showEpisodeSidebar}>
        <PlayerControls
          visible={showControls}
          isPaused={mpv.isPaused}
          isBuffering={mpv.isBuffering}
          currentTime={mpv.currentTime}
          duration={mpv.duration}
          cacheDuration={mpv.cacheDuration}
          primaryTitle={state.primaryTitle}
          secondaryTitle={activeEpisode?.title || state.secondaryTitle}
          nextEpisodeTitle={nextEpisodeTitle}
          showNextEpisode={showNextBtn}
          onBack={() => navigate(-1)}
          onTogglePause={() => {
            mpv.togglePause();
            revealControls();
          }}
          onSeek={(t) => {
            mpv.seek(t);
            revealControls();
          }}
          onRequestThumbnail={mpv.requestThumbnail}
          thumbnailKey={`${selectedStream?.link || ""}:${activeEpisodeIndex}`}
          onScrubbingChange={(scrubbing) => {
            isScrubbingRef.current = scrubbing;
            if (controlsTimerRef.current) {
              clearTimeout(controlsTimerRef.current);
              controlsTimerRef.current = null;
            }
            setShowControls(true);
            if (!scrubbing) scheduleHide();
          }}
          onNextEpisode={handleNextEpisode}
          onPrevEpisode={handlePrevEpisode}
          hasNextEpisode={activeEpisodeIndex < state.episodeList.length - 1}
          hasPrevEpisode={activeEpisodeIndex > 0}
          onToggleFullscreen={toggleFullscreen}
          isFullscreen={isFullscreen}
          onTogglePip={togglePip}
          isPip={isPip}
          onToggleCrop={toggleCrop}
          isCropped={isCropped}
          zoomLevel={zoomLevel}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
          onSetZoom={applyZoom}
          onClickBackground={handleBackgroundClick}
          audioTracks={mpv.audioTracks}
          subtitleTracks={mpv.subtitleTracks}
          videoTracks={mpv.videoTracks}
          audioDelay={mpv.audioDelay}
          onAudioDelayChange={(delayMs) => {
            mpv.setAudioDelay?.(delayMs);
            toast(`Audio Sync: ${delayMs > 0 ? `+${delayMs}` : delayMs}ms`);
          }}
          subtitleDelay={mpv.subtitleDelay}
          onSubtitleDelayChange={(delayMs) => {
            mpv.setSubtitleDelay?.(delayMs);
            toast(`Subtitle Sync: ${delayMs > 0 ? `+${delayMs}` : delayMs}ms`);
          }}
          chapters={mpv.chapters}
          videoHeight={mpv.videoHeight}
          playbackRate={playbackRate}
          streamData={streamData}
          selectedStream={selectedStream}
          onSelectStream={(stream) => handleStreamSelect(stream, true)}
          onSelectAudioTrack={(id) => {
            appliedAudioForStreamRef.current = selectedStream?.link || null;
            mpv.selectTrack("aid", id);
            const index = mpv.audioTracks.findIndex((item) => item.id === id);
            const track = mpv.audioTracks[index];
            if (track) {
              saveAudioPreference(state, track, index >= 0 ? index : undefined);
            }
            toast(`Audio: ${track ? formatTrackLabel(track) : String(id)}`);
          }}
          onSelectSubtitleTrack={(id) => {
            appliedSubtitleForStreamRef.current = selectedStream?.link || null;
            mpv.selectTrack("sid", id);
            if (id === "no") {
              saveSubtitlePreference(state, "off");
              toast("Subtitles: Off");
            } else {
              const index = mpv.subtitleTracks.findIndex(
                (item) => item.id === id,
              );
              const track = mpv.subtitleTracks[index];
              if (track) {
                saveSubtitlePreference(
                  state,
                  track,
                  index >= 0 ? index : undefined,
                );
              }
              toast(`Subtitles: ${track ? formatTrackLabel(track) : String(id)}`);
            }
          }}
          onSelectVideoTrack={(id) => {
            mpv.selectTrack("vid", id);
          }}
          onAddSubtitleFile={(path, title) => mpv.addSubtitleFile(path, title)}
          onPlaybackRateChange={(rate) => {
            setPlaybackRate(rate);
            mpv.setPlaybackSpeed(rate);
          }}
          showShortcuts={showShortcuts}
          onToggleShortcuts={() => setShowShortcuts((current) => !current)}
          onOpenVlc={openInVlc}
          onCopyLink={selectedStream?.link ? copyStreamLink : undefined}
          skips={combinedSkips}
        />
        {showEpisodeSidebarSetting && hasMultipleEpisodes && (
          <FocusableButton
            type="button"
            focusable={showControls && !showEpisodeSidebar && tvMode}
            focusKey="PLAYER_EPISODES_DRAWER_TOGGLE"
            className={`player-episode-sidebar-toggle ${showControls && !showEpisodeSidebar ? "visible" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowEpisodeSidebar((prev) => !prev);
              revealControls();
            }}
            title="Episodes"
            aria-label="Toggle episode list sidebar"
          >
            <ChevronLeft size={20} />
          </FocusableButton>
        )}
      </ControlsFocusProvider>

      {showEpisodeSidebarSetting && hasMultipleEpisodes && (
        <>
          <div
            className={`player-episode-sidebar-backdrop ${showEpisodeSidebar ? "visible" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setShowEpisodeSidebar(false);
            }}
          />
          <FocusContext.Provider value={sidebarFocusKey}>
            <aside
              ref={sidebarFocusRef}
              className={`player-episode-sidebar ${showEpisodeSidebar ? "open" : ""}`}
              data-prevent-wheel-volume="true"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="player-episode-sidebar-header">
                <div className="player-episode-sidebar-title-group">
                  <ListIcon size={18} className="player-episode-sidebar-icon" />
                  <h3 className="player-episode-sidebar-title">Episodes</h3>
                  <span className="player-episode-sidebar-count">
                    {state.episodeList.length}
                  </span>
                </div>
                <FocusableButton
                  type="button"
                  focusable={showEpisodeSidebar && tvMode}
                  focusKey="EPISODE_SIDEBAR_CLOSE"
                  className="player-episode-sidebar-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowEpisodeSidebar(false);
                  }}
                  aria-label="Close episode list"
                >
                  <CloseIcon size={18} />
                </FocusableButton>
              </div>
              <div
                className="player-episode-sidebar-list"
                data-prevent-wheel-volume="true"
              >
                {state.episodeList.map((ep: any, index: number) => {
                  const isActive = index === activeEpisodeIndex;
                  const epNum = index + 1;
                  const epTitle = ep?.title || `Episode ${epNum}`;
                  return (
                    <SidebarEpisodeItem
                      key={ep?.id || ep?.link || index}
                      episode={ep}
                      index={index}
                      isActive={isActive}
                      itemRef={isActive ? activeEpisodeItemRef : undefined}
                      focusable={showEpisodeSidebar && tvMode}
                      onSelect={() => {
                        if (index !== activeEpisodeIndex) {
                          prevStreamLinkRef.current = null;
                          appliedAudioForStreamRef.current = null;
                          appliedSubtitleForStreamRef.current = null;
                          setActiveEpisodeIndex(index);
                          toast(`Playing: ${epTitle}`);
                        }
                        setShowEpisodeSidebar(false);
                      }}
                    />
                  );
                })}
              </div>
            </aside>
          </FocusContext.Provider>
        </>
      )}

      {toastMessage && <div className="player-toast">{toastMessage}</div>}
    </div>
  );
};

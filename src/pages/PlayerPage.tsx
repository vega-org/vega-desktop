import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMpvPlayer } from "../lib/hooks/useMpvPlayer";
import { useStream } from "../lib/hooks/useStream";
import { usePlayerProgress } from "../lib/hooks/usePlayerSettings";
import { useMediaSession } from "../lib/hooks/useMediaSession";
import useContentStore from "../lib/zustand/contentStore";
import useWatchHistoryStore from "../lib/zustand/watchHistrory";
import { cacheStorage } from "../lib/storage";
import { PlayerControls } from "./PlayerControls";
import { PlayerInitError } from "./PlayerInitError";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { FocusableButton } from "../components/layout/FocusableButton";
import { syncFromSharedFolder } from "../lib/sync/syncService";
import { settingsStorage } from "../lib/storage/SettingsStorage";

import {
  LuArrowLeft as ArrowLeft,
  LuExternalLink as ExternalLink,
  LuPlay as Play,
  LuServer as Server,
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
  const isLinux =
    navigator.userAgent.toLowerCase().includes("linux") && !isAndroid;
  const useExternalPlayer =
    isAndroid && settingsStorage.isExternalPlayerEnabled();
  const useVlc = !isAndroid && settingsStorage.isVlcEnabled();

  if (isAndroid || isLinux || useVlc) {
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
        isLinux={isLinux}
        useExternalPlayer={useExternalPlayer}
        useVlc={useVlc}
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
  isLinux,
  useExternalPlayer,
  useVlc,
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
    preferredChildFocusKey: "TV_SERVER_0",
  });

  useEffect(() => {
    if (!streamLoading && !streamError) {
      // Focus the boundary after loading completes and children render
      const timer = setTimeout(() => focusSelf(), 50);
      return () => clearTimeout(timer);
    }
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

        if (playUrl.startsWith("magnet:")) {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const apiPort = await invoke<number>("get_torrent_api_port");
            const addRes = await fetch(`http://127.0.0.1:${apiPort}/torrents`, {
              method: "POST",
              body: playUrl,
            });
            if (!addRes.ok) throw new Error("Failed to add torrent");
            const data = await addRes.json();
            const infoHash = data.details.info_hash;

            // Wait for torrent to become live
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline) {
              const statsRes = await fetch(
                `http://127.0.0.1:${apiPort}/torrents/${infoHash}/stats/v1`,
              );
              if (statsRes.ok) {
                const stats = await statsRes.json();
                if (stats.state === "live" || stats.state === "paused") break;
              }
              await new Promise((r) => setTimeout(r, 500));
            }

            const torrentFiles = data.details.files || [];
            const rawName = torrentFiles[0]?.name || "";
            const fileName = rawName.substring(
              Math.max(rawName.lastIndexOf("/"), rawName.lastIndexOf("\\")) + 1,
            );
            const nameSuffix = fileName
              ? `/${encodeURIComponent(fileName)}`
              : "";
            playUrl = `http://127.0.0.1:${apiPort}/torrents/${infoHash}/stream/0${nameSuffix}`;
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
        } else if (isLinux || useVlc) {
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
    [isAndroid, isLinux, useExternalPlayer, useVlc],
  );

  if (streamLoading) {
    return (
      <div
        className="player-page"
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
            backgroundColor: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(20px)",
          }}
        />
        <FocusableButton
          className="player-loading-back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <ArrowLeft size={23} />
        </FocusableButton>
        <div className="player-loading" style={{ background: "transparent" }}>
          <div className="loading-spinner" />
          <span className="loading-text">Fetching Stream...</span>
        </div>
      </div>
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
              backdropFilter: "blur(20px)",
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
                  <h2>Select server</h2>
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
}) => {
  const navigate = useNavigate();
  const { history, addItem, updatePlaybackInfo } = useWatchHistoryStore();
  const { provider } = useContentStore();

  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [isCropped, setIsCropped] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const toastIdRef = useRef(0);
  const controlsTimerRef = useRef<number | null>(null);
  const prevStreamLinkRef = useRef<string | null>(null);
  const prePipStateRef = useRef<{ size: any; pos: any } | null>(null);
  const preFullscreenStateRef = useRef<{
    size: any;
    pos: any;
    maximized: boolean;
    alwaysOnTop: boolean;
  } | null>(null);
  const manualFullscreenRef = useRef(false);
  const isWindows = navigator.userAgent.toLowerCase().includes("windows");

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

  const toast = useCallback((msg: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, msg }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      2200,
    );
  }, []);

  const openInVlc = useCallback(async () => {
    if (!selectedStream?.link) return;
    try {
      await invoke("open_external_player", {
        url: selectedStream.link,
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
      setActiveEpisodeIndex((prev: number) => prev - 1);
      toast("Playing previous episode");
    }
  }, [activeEpisodeIndex, toast, setActiveEpisodeIndex]);

  const mpv = useMpvPlayer({
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
        } catch {}
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
        await win.setFullscreen(false).catch(() => {});
        if (previousState) {
          await win.setAlwaysOnTop(previousState.alwaysOnTop).catch(() => {});
          if (previousState.maximized) {
            await win.maximize().catch(() => {});
            await invoke("ensure_window_in_work_area", {
              maximized: true,
            }).catch(() => {});
          } else if (manualFullscreenRef.current) {
            await win.setPosition(previousState.pos).catch(() => {});
            await win.setSize(previousState.size).catch(() => {});
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
    if (mpv.isInitialized) mpv.updateSubtitleSettings();
  }, [mpv.isInitialized]);

  useEffect(() => {
    if (!mpv.isInitialized || !selectedStream?.link) return;
    if (prevStreamLinkRef.current === selectedStream.link) return;
    prevStreamLinkRef.current = selectedStream.link;

    (async () => {
      const subs = selectedStream.subtitles?.length
        ? selectedStream.subtitles
        : externalSubs;
      await mpv.loadFile(
        selectedStream.link,
        selectedStream.headers,
        subs,
        selectedStream.type,
        selectedStream.localBaseDir,
      );
    })();
  }, [
    mpv.isInitialized,
    selectedStream?.link,
    activeEpisode?.link,
    toast,
    externalSubs,
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
    if (!showShortcuts) setShowControls(false);
  }, [showShortcuts]);
  const scheduleHide = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(hideControls, 3500);
  }, [hideControls]);

  const revealControls = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

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

  useEffect(() => {
    import("@noriginmedia/norigin-spatial-navigation-core")
      .then(({ pause, resume }) => {
        pause();
        return () => resume();
      })
      .catch(() => {});

    const handleWheel = (e: WheelEvent) => {
      revealControls();
      const newVol =
        e.deltaY < 0
          ? Math.min(150, mpv.volume + 5)
          : Math.max(0, mpv.volume - 5);
      mpv.setVolumeLevel(newVol);
    };

    const onMouseMoveEvent = () => revealControls();
    const onTouch = () => revealControls();
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      revealControls();
      const key = e.key.toLowerCase();
      switch (key) {
        case " ":
        case "k":
        case "enter":
          e.preventDefault();
          mpv.togglePause();
          break;
        case "arrowleft":
          e.preventDefault();
          mpv.seek(-10, "relative");
          break;
        case "arrowright":
          e.preventDefault();
          mpv.seek(10, "relative");
          break;
        case "arrowup":
          e.preventDefault();
          mpv.setVolumeLevel(Math.min(150, mpv.volume + 5));
          toast(`Volume: ${Math.min(150, Math.round(mpv.volume + 5))}%`);
          break;
        case "arrowdown":
          e.preventDefault();
          mpv.setVolumeLevel(Math.max(0, mpv.volume - 5));
          toast(`Volume: ${Math.max(0, Math.round(mpv.volume - 5))}%`);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "escape":
          if (showShortcuts) setShowShortcuts(false);
          else if (isFullscreen) toggleFullscreen();
          else navigate(-1);
          break;
        case "m":
          mpv.setVolumeLevel(mpv.volume > 0 ? 0 : 100);
          toast(mpv.volume > 0 ? "Muted" : "Unmuted");
          break;
        case "n":
          handleNextEpisode();
          break;
        case "a": {
          if (!mpv.audioTracks.length) break;
          e.preventDefault();
          const selectedIndex = mpv.audioTracks.findIndex(
            (track) => track.selected,
          );
          const nextTrack =
            mpv.audioTracks[(selectedIndex + 1) % mpv.audioTracks.length];
          mpv.selectTrack("aid", nextTrack.id);
          toast(`Audio: ${formatTrackLabel(nextTrack)}`);
          break;
        }
        case "t": {
          e.preventDefault();
          const selectedIndex = mpv.subtitleTracks.findIndex(
            (track) => track.selected,
          );
          if (
            !mpv.subtitleTracks.length ||
            selectedIndex === mpv.subtitleTracks.length - 1
          ) {
            mpv.selectTrack("sid", "no");
            toast("Subtitles: Off");
          } else {
            const nextTrack = mpv.subtitleTracks[selectedIndex + 1];
            mpv.selectTrack("sid", nextTrack.id);
            toast(`Subtitles: ${formatTrackLabel(nextTrack)}`);
          }
          break;
        }
        case "<":
        case ">": {
          e.preventDefault();
          const step = key === "<" ? -0.25 : 0.25;
          const nextRate = Math.min(
            4,
            Math.max(0.25, Math.round((playbackRate + step) * 100) / 100),
          );
          setPlaybackRate(nextRate);
          mpv.setPlaybackSpeed(nextRate);
          toast(`Speed: ${nextRate.toFixed(2)}x`);
          break;
        }
        case "s": {
          e.preventDefault();
          const nextChapter = mpv.chapters.find(
            (chapter) => chapter.time > mpv.currentTime + 1,
          );
          if (nextChapter) {
            mpv.seek(nextChapter.time);
            toast(`Chapter: ${nextChapter.title}`);
          } else {
            toast("No next chapter");
          }
          break;
        }
        case "?":
          e.preventDefault();
          setShowShortcuts((current) => !current);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", handleWheel);
    window.addEventListener("mousemove", onMouseMoveEvent);
    window.addEventListener("touchstart", onTouch);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("mousemove", onMouseMoveEvent);
      window.removeEventListener("touchstart", onTouch);
      import("@noriginmedia/norigin-spatial-navigation-core")
        .then(({ resume }) => resume())
        .catch(() => {});
    };
  }, [
    mpv,
    isFullscreen,
    handleNextEpisode,
    revealControls,
    toast,
    playbackRate,
    showShortcuts,
  ]);

  const toggleFullscreen = async () => {
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
        // Windows-safe borderless fallback: use the monitor's full bounds,
        // not its taskbar-reduced work area.
        if (!monitor) throw new Error("Unable to determine the active monitor");
        if (await win.isMaximized()) await win.unmaximize();
        await win.setDecorations(false);
        await win.setPosition(monitor.position);
        await win.setSize(monitor.size);
        await win.setAlwaysOnTop(true);
        manualFullscreenRef.current = true;
      } else {
        // Keeps Windows' taskbar below the verified fullscreen window.
        await win.setAlwaysOnTop(true);
      }

      setIsFullscreen(true);
    } catch (e) {
      console.error(e);
      const previousState = preFullscreenStateRef.current;
      await win.setFullscreen(false).catch(() => {});
      await win
        .setAlwaysOnTop(previousState?.alwaysOnTop ?? false)
        .catch(() => {});
      if (previousState?.maximized) {
        await win.maximize().catch(() => {});
        await invoke("ensure_window_in_work_area", { maximized: true }).catch(
          () => {},
        );
      } else if (previousState) {
        await win.setPosition(previousState.pos).catch(() => {});
        await win.setSize(previousState.size).catch(() => {});
      }
      manualFullscreenRef.current = false;
      preFullscreenStateRef.current = null;
      setIsFullscreen(false);
    }
  };

  const togglePip = async () => {
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
  };

  const toggleCrop = () => {
    const nextCrop = !isCropped;
    setIsCropped(nextCrop);
    mpv.setProperty("panscan", nextCrop ? 1.0 : 0.0);
  };

  const handleStreamSelect = useCallback(
    (stream: any) => {
      prevStreamLinkRef.current = null;
      setSelectedStream(stream);
    },
    [setSelectedStream],
  );

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

  if (streamLoading) {
    const bgUrl = state.poster?.background || state.poster?.poster;
    return (
      <div className="player-page controls-visible">
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
                backgroundColor: "rgba(0,0,0,0.85)",
                backdropFilter: "blur(20px)",
                zIndex: -1,
              }}
            />
          </>
        )}
        <FocusableButton
          className="player-loading-back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <ArrowLeft size={23} />
        </FocusableButton>
        <div
          className="player-loading"
          style={{ background: bgUrl ? "transparent" : "#000" }}
        >
          <div className="loading-spinner" />
          <span className="loading-text">Fetching stream...</span>
        </div>
      </div>
    );
  }

  if (streamError) {
    const bgUrl = state.poster?.background || state.poster?.poster;
    return (
      <div className="player-page controls-visible">
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
                backgroundColor: "rgba(0,0,0,0.85)",
                backdropFilter: "blur(20px)",
                zIndex: -1,
              }}
            />
          </>
        )}
        <div
          className="player-error"
          style={{ background: bgUrl ? "transparent" : "#000" }}
        >
          <p>{streamError.message || "Failed to load stream"}</p>
          <button onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    );
  }

  if (mpv.initializationError) {
    return (
      <PlayerInitError
        error={mpv.initializationError}
        onBack={() => navigate(-1)}
        onOpenVlc={selectedStream?.link ? openInVlc : undefined}
      />
    );
  }

  return (
    <div
      className={`player-page ${showControls ? "controls-visible" : ""}`}
      onMouseMove={handleMouseMove}
      style={{ backgroundColor: mpv.currentTime > 0 ? "transparent" : "#000" }}
      {...(isPip ? { "data-tauri-drag-region": true } : {})}
    >
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
        onClickBackground={handleBackgroundClick}
        audioTracks={mpv.audioTracks}
        subtitleTracks={mpv.subtitleTracks}
        videoTracks={mpv.videoTracks}
        chapters={mpv.chapters}
        videoHeight={mpv.videoHeight}
        playbackRate={playbackRate}
        streamData={streamData}
        selectedStream={selectedStream}
        onSelectStream={handleStreamSelect}
        onSelectAudioTrack={(id) => {
          mpv.selectTrack("aid", id);
          const track = mpv.audioTracks.find((item) => item.id === id);
          toast(`Audio: ${track ? formatTrackLabel(track) : String(id)}`);
        }}
        onSelectSubtitleTrack={(id) => {
          mpv.selectTrack("sid", id);
          if (id === "no") {
            toast("Subtitles: Off");
          } else {
            const track = mpv.subtitleTracks.find((item) => item.id === id);
            toast(`Subtitles: ${track ? formatTrackLabel(track) : String(id)}`);
          }
        }}
        onSelectVideoTrack={(id) => {
          mpv.selectTrack("vid", id);
        }}
        onAddSubtitleFile={(path) => mpv.addSubtitleFile(path)}
        onPlaybackRateChange={(rate) => {
          setPlaybackRate(rate);
          mpv.setPlaybackSpeed(rate);
        }}
        showShortcuts={showShortcuts}
        onToggleShortcuts={() => setShowShortcuts((current) => !current)}
        onOpenVlc={openInVlc}
        onCopyLink={selectedStream?.link ? copyStreamLink : undefined}
      />
      {toasts.map((t) => (
        <div key={t.id} className="player-toast">
          {t.msg}
        </div>
      ))}
    </div>
  );
};

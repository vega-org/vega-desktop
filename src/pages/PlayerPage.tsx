import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMpvPlayer } from '../lib/hooks/useMpvPlayer';
import { useStream } from '../lib/hooks/useStream';
import { usePlayerProgress } from '../lib/hooks/usePlayerSettings';
import useContentStore from '../lib/zustand/contentStore';
import useWatchHistoryStore from '../lib/zustand/watchHistrory';
import { cacheStorage } from '../lib/storage';
import { PlayerControls } from './PlayerControls';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import './PlayerPage.css';

interface PlayerLocationState {
  episodeList: any[];
  linkIndex: number;
  primaryTitle: string;
  secondaryTitle?: string;
  type: string;
  poster?: { poster?: string; logo?: string; background?: string };
  providerValue: string;
  infoUrl: string;
}

export const PlayerPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as PlayerLocationState | undefined;

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

  return <PlayerInner key={state.infoUrl} state={state} />;
};

interface PlayerInnerProps {
  state: PlayerLocationState;
}

const PlayerInner: React.FC<PlayerInnerProps> = ({ state }) => {
  const navigate = useNavigate();
  const { provider } = useContentStore();
  const { addItem, updatePlaybackInfo } = useWatchHistoryStore();

  const [activeEpisodeIndex, setActiveEpisodeIndex] = useState(state.linkIndex);
  const activeEpisode = state.episodeList[activeEpisodeIndex];

  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [isCropped, setIsCropped] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const toastIdRef = useRef(0);
  const controlsTimerRef = useRef<number | null>(null);
  const prevStreamLinkRef = useRef<string | null>(null);
  const prePipStateRef = useRef<{ size: any; pos: any } | null>(null);

  // Toast
  const toast = useCallback((msg: string) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2200);
  }, []);

  const routeParams = useMemo(() => ({
    episodeList: state.episodeList,
    linkIndex: activeEpisodeIndex,
    type: state.type,
    primaryTitle: state.primaryTitle,
    secondaryTitle: state.secondaryTitle,
    providerValue: state.providerValue,
    infoUrl: state.infoUrl,
    poster: state.poster,
  }), [state, activeEpisodeIndex]);

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
    provider: state.providerValue || provider?.value || '',
  });

  const handleNextEpisode = useCallback(() => {
    if (activeEpisodeIndex < state.episodeList.length - 1) {
      prevStreamLinkRef.current = null;
      setActiveEpisodeIndex(prev => prev + 1);
      toast('Playing next episode');
    }
  }, [activeEpisodeIndex, state.episodeList.length, toast]);

  const handlePrevEpisode = useCallback(() => {
    if (activeEpisodeIndex > 0) {
      prevStreamLinkRef.current = null;
      setActiveEpisodeIndex(prev => prev - 1);
      toast('Playing previous episode');
    }
  }, [activeEpisodeIndex, toast]);

  const mpv = useMpvPlayer({
    onEof: () => {
      if (activeEpisodeIndex < state.episodeList.length - 1) handleNextEpisode();
    },
    onFileLoaded: () => {
      const cached = cacheStorage.getString(activeEpisode?.link);
      if (cached) {
        try {
          const { position } = JSON.parse(cached);
          if (position > 5) mpv.seek(position);
        } catch {}
      }
    }
  });

  const { handleProgress } = usePlayerProgress({
    activeEpisode,
    routeParams,
    playbackRate,
    updatePlaybackInfo,
  });

  // Transparent background for mpv
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const root = document.getElementById('root');
    if (root) root.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
      if (root) root.style.background = '';
    };
  }, []);

  // Init mpv
  useEffect(() => {
    mpv.initPlayer();
    return () => { mpv.destroyPlayer(); };
  }, []);

  // Update subtitle settings when player initializes
  useEffect(() => {
    if (mpv.isInitialized) {
      mpv.updateSubtitleSettings();
    }
  }, [mpv.isInitialized]);

  // Load file when stream ready
  useEffect(() => {
    if (!mpv.isInitialized || !selectedStream?.link) return;
    if (prevStreamLinkRef.current === selectedStream.link) return;
    prevStreamLinkRef.current = selectedStream.link;

    (async () => {
      toast(`Loading: ${selectedStream.link}`);
      const subs = selectedStream.subtitles?.length ? selectedStream.subtitles : externalSubs;
      await mpv.loadFile(selectedStream.link, selectedStream.headers, subs);
    })();
  }, [mpv.isInitialized, selectedStream?.link, activeEpisode?.link, toast, externalSubs]);

  // Track progress
  useEffect(() => {
    if (mpv.currentTime > 0 && mpv.duration > 0) {
      handleProgress({ currentTime: mpv.currentTime, seekableDuration: mpv.duration });
    }
  }, [Math.floor(mpv.currentTime)]);

  // Watch history
  useEffect(() => {
    if (!state.primaryTitle) return;
    addItem({
      id: state.infoUrl || activeEpisode?.link,
      title: state.primaryTitle,
      poster: state.poster?.poster || state.poster?.background || '',
      link: state.infoUrl || '',
      provider: state.providerValue || provider?.value || '',
      lastPlayed: Date.now(),
      duration: 0,
      currentTime: 0,
      playbackRate: 1,
      episodeTitle: state.secondaryTitle,
    });
  }, [activeEpisode?.link]);

  // --- Controls visibility ---
  const hideControls = useCallback(() => {
    setShowControls(false);
  }, []);

  const scheduleHide = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(hideControls, 3500);
  }, [hideControls]);

  const revealControls = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (showControls) {
      scheduleHide();
    }
  }, [showControls, scheduleHide]);

  const handleMouseMove = useCallback(() => { revealControls(); }, [revealControls]);

  const handleBackgroundClick = useCallback(() => {
    if (showControls) {
      setShowControls(false);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    } else {
      revealControls();
    }
  }, [showControls, revealControls]);


  // Keyboard
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      revealControls();
      const newVol = e.deltaY < 0 ? Math.min(150, mpv.volume + 5) : Math.max(0, mpv.volume - 5);
      mpv.setVolumeLevel(newVol);
    };

    const onMouseMove = () => revealControls();
    const onTouch = () => revealControls();
    const onKey = (e: KeyboardEvent) => {
      revealControls();
      switch (e.key) {
        case ' ': case 'k':
          e.preventDefault(); mpv.togglePause(); break;
        case 'ArrowLeft':
          e.preventDefault(); mpv.seek(-10, 'relative'); break;
        case 'ArrowRight':
          e.preventDefault(); mpv.seek(10, 'relative'); break;
        case 'ArrowUp':
          e.preventDefault();
          mpv.setVolumeLevel(Math.min(150, mpv.volume + 5));
          toast(`Volume: ${Math.min(150, Math.round(mpv.volume + 5))}%`);
          break;
        case 'ArrowDown':
          e.preventDefault();
          mpv.setVolumeLevel(Math.max(0, mpv.volume - 5));
          toast(`Volume: ${Math.max(0, Math.round(mpv.volume - 5))}%`);
          break;
        case 'f':
          toggleFullscreen(); break;
        case 'Escape':
          if (isFullscreen) toggleFullscreen();
          else navigate(-1);
          break;
        case 'm':
          mpv.setVolumeLevel(mpv.volume > 0 ? 0 : 100);
          toast(mpv.volume > 0 ? 'Muted' : 'Unmuted');
          break;
        case 'n':
          handleNextEpisode(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', handleWheel);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchstart', onTouch);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchstart', onTouch);
    };
  }, [mpv, isFullscreen, handleNextEpisode, revealControls, toast]);

  const toggleFullscreen = async () => {
    try {
      const win = getCurrentWindow();
      const isFull = await win.isFullscreen();
      await win.setFullscreen(!isFull);
      setIsFullscreen(!isFull);
    } catch (e) {
      console.error(e);
    }
  };

  const togglePip = async () => {
    try {
      const win = getCurrentWindow();
      const currentPip = await win.isAlwaysOnTop();
      const nextPip = !currentPip;
      
      if (nextPip) {
        // Save current window state before entering PIP
        const size = await win.innerSize();
        const pos = await win.outerPosition();
        prePipStateRef.current = { size, pos };
      }
      
      await win.setAlwaysOnTop(nextPip);
      await win.setDecorations(!nextPip);
      
      setIsPip(nextPip);
      if (nextPip) {
        await win.setSize(new LogicalSize(480, 270));
      } else {
        // Restore pre-PIP state
        if (prePipStateRef.current) {
          await win.setSize(prePipStateRef.current.size);
          await win.setPosition(prePipStateRef.current.pos);
        } else {
          await win.setSize(new LogicalSize(1280, 720)); // Approximate standard
        }
      }
    } catch(e) {
      console.error(e);
    }
  };

  const toggleCrop = () => {
    const nextCrop = !isCropped;
    setIsCropped(nextCrop);
    mpv.setProperty('panscan', nextCrop ? 1.0 : 0.0);
  };

  const handleStreamSelect = useCallback((stream: any) => {
    prevStreamLinkRef.current = null;
    setSelectedStream(stream);
  }, []);

  const showNextBtn = useMemo(() => {
    if (activeEpisodeIndex >= state.episodeList.length - 1) return false;
    if (mpv.duration <= 0) return false;
    return (mpv.currentTime / mpv.duration) > 0.8;
  }, [activeEpisodeIndex, mpv.currentTime, mpv.duration]);

  // --- Render ---
  if (streamLoading) {
    return (
      <div className="player-page">
        <div className="player-loading">
          <div className="loading-spinner" />
          <span className="loading-text">Fetching stream...</span>
        </div>
      </div>
    );
  }

  if (streamError) {
    return (
      <div className="player-page">
        <div className="player-error">
          <p>{streamError.message || 'Failed to load stream'}</p>
          <button onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`player-page ${showControls ? 'controls-visible' : ''}`}
      onMouseMove={handleMouseMove}
      style={{ backgroundColor: mpv.currentTime > 0 ? 'transparent' : '#000' }}
      {...(isPip ? { 'data-tauri-drag-region': true } : {})}
    >
      <PlayerControls
        visible={showControls}
        isPaused={mpv.isPaused}
        isBuffering={mpv.isBuffering}
        currentTime={mpv.currentTime}
        duration={mpv.duration}
        primaryTitle={state.primaryTitle}
        secondaryTitle={activeEpisode?.title || state.secondaryTitle}
        showNextEpisode={showNextBtn}
        onBack={() => navigate(-1)}
        onTogglePause={() => { mpv.togglePause(); revealControls(); }}
        onSeek={(t) => { mpv.seek(t); revealControls(); }}
        onSeekRelative={(d) => { mpv.seek(d, 'relative'); revealControls(); }}
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
        videoHeight={mpv.videoHeight}
        playbackRate={playbackRate}
        streamData={streamData}
        selectedStream={selectedStream}
        onSelectStream={handleStreamSelect}
        onSelectAudioTrack={(id) => { mpv.selectTrack('aid', id); }}
        onSelectSubtitleTrack={(id) => { mpv.selectTrack('sid', id); }}
        onSelectVideoTrack={(id) => { mpv.selectTrack('vid', id); }}
        onAddSubtitleFile={(path) => mpv.addSubtitleFile(path)}
        onPlaybackRateChange={(rate) => { setPlaybackRate(rate); mpv.setPlaybackSpeed(rate); }}
      />



      {toasts.map(t => (
        <div key={t.id} className="player-toast">{t.msg}</div>
      ))}
    </div>
  );
};

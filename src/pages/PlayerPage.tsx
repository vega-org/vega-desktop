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
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation-react';
import { FocusableButton } from '../components/layout/FocusableButton';

import { LuPlay as Play } from 'react-icons/lu';
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
  const { provider } = useContentStore();
  const [activeEpisodeIndex, setActiveEpisodeIndex] = useState(state.linkIndex);
  const activeEpisode = state.episodeList[activeEpisodeIndex];

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

  const isAndroid = navigator.userAgent.toLowerCase().includes('android');
  const isLinux = navigator.userAgent.toLowerCase().includes('linux') && !isAndroid;

  if (isAndroid || isLinux) {
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
  isLinux
}) => {
  const navigate = useNavigate();
  const { addItem } = useWatchHistoryStore();
  const [isLaunching, setIsLaunching] = useState(false);

  const { ref: focusRef, focusKey, focusSelf } = useFocusable({
    focusable: true,
    trackChildren: true,
    isFocusBoundary: true,
    preferredChildFocusKey: 'TV_SERVER_0',
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
    if (state.primaryTitle) {
      addItem({
        id: state.infoUrl || activeEpisode?.link,
        title: state.primaryTitle,
        poster: state.poster?.poster || state.poster?.background || '',
        link: state.infoUrl || '',
        provider: state.providerValue || '',
        lastPlayed: Date.now(),
        playbackRate: 1,
        episodeTitle: state.secondaryTitle,
      });
    }
  }, [state.primaryTitle, activeEpisode?.link, addItem]);

  const handlePlayNative = useCallback(async (stream: any) => {
    if (!stream?.link) return;
    setIsLaunching(true);
    try {
      if (isAndroid) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        const headers = stream.headers ? JSON.stringify(stream.headers) : '';
        const intentUrl = `vega://play?url=${encodeURIComponent(stream.link)}&headers=${encodeURIComponent(headers)}`;
        await openUrl(intentUrl);
      } else if (isLinux) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_external_player', { url: stream.link }).catch(console.error);
      }
    } catch (e) {
      console.error("Failed to open player", e);
    } finally {
      // Keep loader visible for a couple seconds to cover the external player's startup time
      setTimeout(() => setIsLaunching(false), 2000);
    }
  }, [isAndroid, isLinux]);

  if (streamLoading) {
    return (
      <div className="player-page" style={{ backgroundImage: `url(${state.poster?.background})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="player-page-overlay" style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)' }} />
        <div className="player-loading" style={{ background: 'transparent' }}>
          <div className="loading-spinner" />
          <span className="loading-text">Fetching Stream...</span>
        </div>
      </div>
    );
  }

  if (streamError) {
    const bgUrl = state.poster?.background || state.poster?.poster;
    return (
      <div className="player-page controls-visible" style={{ backgroundImage: bgUrl ? `url(${bgUrl})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center' }}>
        {bgUrl && <div className="player-page-overlay" style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)' }} />}
        <div className="player-error" style={{ background: bgUrl ? 'transparent' : '#000', zIndex: 1 }}>
          <p>{streamError.message || 'Failed to load stream'}</p>
          <FocusableButton className="action-btn primary-btn" onClick={() => navigate(-1)}>
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
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundImage: `url(${state.poster?.background || state.poster?.poster})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          color: 'white'
        }}
      >
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)' }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '800px', width: '100%', padding: '40px' }}>

          <h2 style={{ fontSize: '3rem', fontWeight: 800, marginBottom: '8px', textAlign: 'center', textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>{state.primaryTitle}</h2>
          {activeEpisode?.title && <h3 style={{ fontSize: '1.5rem', color: '#ccc', marginBottom: '40px', fontWeight: 500 }}>{activeEpisode.title}</h3>}

          {isLaunching ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '40px' }}>
              <div className="loading-spinner" />
              <span style={{ marginTop: '16px', fontSize: '1.2rem', color: '#ccc' }}>Opening External Player...</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '400px' }}>
              <h4 style={{ fontSize: '1.1rem', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Select Server</h4>

              {streamData?.map((stream: any, idx: number) => (
                <FocusableButton
                  key={idx}
                  focusKey={`TV_SERVER_${idx}`}
                  className={`action-btn ${selectedStream?.link === stream.link ? 'primary-btn' : 'secondary-btn'}`}
                  style={{ width: '100%', justifyContent: 'center', padding: '16px', fontSize: '1.2rem', borderRadius: '12px' }}
                  onClick={() => {
                    setSelectedStream(stream);
                    handlePlayNative(stream);
                  }}
                >
                  <Play size={20} style={{ marginRight: '10px' }} />
                  {stream.server || `Server ${idx + 1}`} {stream.quality ? `(${stream.quality})` : ''}
                </FocusableButton>
              ))}
            </div>
          )}

          <FocusableButton
            focusKey="TV_SERVER_BACK"
            className="action-btn text-btn"
            style={{ marginTop: '50px', fontSize: '1.2rem', opacity: 0.8 }}
            onClick={() => navigate(-1)}
          >
            Go Back
          </FocusableButton>

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
  routeParams
}) => {
  const navigate = useNavigate();
  const { addItem, updatePlaybackInfo } = useWatchHistoryStore();
  const { provider } = useContentStore();

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

  const toast = useCallback((msg: string) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2200);
  }, []);

  const handleNextEpisode = useCallback(() => {
    if (activeEpisodeIndex < state.episodeList.length - 1) {
      prevStreamLinkRef.current = null;
      setActiveEpisodeIndex((prev: number) => prev + 1);
      toast('Playing next episode');
    }
  }, [activeEpisodeIndex, state.episodeList.length, toast, setActiveEpisodeIndex]);

  const handlePrevEpisode = useCallback(() => {
    if (activeEpisodeIndex > 0) {
      prevStreamLinkRef.current = null;
      setActiveEpisodeIndex((prev: number) => prev - 1);
      toast('Playing previous episode');
    }
  }, [activeEpisodeIndex, toast, setActiveEpisodeIndex]);

  const mpv = useMpvPlayer({

    onFileLoaded: () => {
      const uniqueEpisodeKey = `resume_${routeParams?.primaryTitle}_${routeParams?.secondaryTitle}_${activeEpisodeIndex}`;
      console.log('uniqueEpisodeKey', uniqueEpisodeKey);
      const cached = cacheStorage.getString(uniqueEpisodeKey);
      console.log('cached', cached);
      if (cached) {
        try {
          const { position } = JSON.parse(cached);
          if (position > 5) mpv.seek(position);
        } catch { }
      }
    }
  });

  const { handleProgress } = usePlayerProgress({
    activeEpisode,
    routeParams,
    playbackRate,
    updatePlaybackInfo,
  });

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const root = document.getElementById('root');
    if (root) root.style.background = 'transparent';
      return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
      if (root) root.style.background = '';
      getCurrentWindow().setFullscreen(false).catch(() => {});
    };
  }, []);

  useEffect(() => {
    mpv.initPlayer();
    return () => { mpv.destroyPlayer(); };
  }, []);

  useEffect(() => {
    if (mpv.isInitialized) mpv.updateSubtitleSettings();
  }, [mpv.isInitialized]);

  useEffect(() => {
    if (!mpv.isInitialized || !selectedStream?.link) return;
    if (prevStreamLinkRef.current === selectedStream.link) return;
    prevStreamLinkRef.current = selectedStream.link;

    (async () => {
      const subs = selectedStream.subtitles?.length ? selectedStream.subtitles : externalSubs;
      await mpv.loadFile(selectedStream.link, selectedStream.headers, subs, selectedStream.type);
    })();
  }, [mpv.isInitialized, selectedStream?.link, activeEpisode?.link, toast, externalSubs]);

  useEffect(() => {
    if (mpv.currentTime > 0 && mpv.duration > 0) {
      handleProgress({ currentTime: mpv.currentTime, seekableDuration: mpv.duration });
    }
  }, [Math.floor(mpv.currentTime)]);

  useEffect(() => {
    if (!state.primaryTitle) return;
    addItem({
      id: state.infoUrl || activeEpisode?.link,
      title: state.primaryTitle,
      poster: state.poster?.poster || state.poster?.background || '',
      link: state.infoUrl || '',
      provider: state.providerValue || provider?.value || '',
      lastPlayed: Date.now(),
      playbackRate: 1,
      episodeTitle: state.secondaryTitle,
    });
  }, [activeEpisode?.link]);

  const hideControls = useCallback(() => setShowControls(false), []);
  const scheduleHide = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(hideControls, 3500);
  }, [hideControls]);

  const revealControls = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => { if (showControls) scheduleHide(); }, [showControls, scheduleHide]);

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
    import('@noriginmedia/norigin-spatial-navigation-core').then(({ pause, resume }) => {
      pause();
      return () => resume();
    }).catch(() => { });

    const handleWheel = (e: WheelEvent) => {
      revealControls();
      const newVol = e.deltaY < 0 ? Math.min(150, mpv.volume + 5) : Math.max(0, mpv.volume - 5);
      mpv.setVolumeLevel(newVol);
    };

    const onMouseMoveEvent = () => revealControls();
    const onTouch = () => revealControls();
    const onKey = (e: KeyboardEvent) => {
      revealControls();
      switch (e.key) {
        case ' ': case 'k': case 'Enter':
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
    window.addEventListener('mousemove', onMouseMoveEvent);
    window.addEventListener('touchstart', onTouch);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mousemove', onMouseMoveEvent);
      window.removeEventListener('touchstart', onTouch);
      import('@noriginmedia/norigin-spatial-navigation-core').then(({ resume }) => resume()).catch(() => { });
    };
  }, [mpv, isFullscreen, handleNextEpisode, revealControls, toast]);

  const toggleFullscreen = async () => {
    try {
      const win = getCurrentWindow();
      const isFull = await win.isFullscreen();
      await win.setFullscreen(!isFull);
      setIsFullscreen(!isFull);
    } catch (e) { console.error(e); }
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
      await win.setDecorations(!nextPip);
      setIsPip(nextPip);
      if (nextPip) {
        await win.setSize(new LogicalSize(480, 270));
      } else {
        if (prePipStateRef.current) {
          await win.setSize(prePipStateRef.current.size);
          await win.setPosition(prePipStateRef.current.pos);
        } else {
          await win.setSize(new LogicalSize(1280, 720));
        }
      }
    } catch (e) { console.error(e); }
  };

  const toggleCrop = () => {
    const nextCrop = !isCropped;
    setIsCropped(nextCrop);
    mpv.setProperty('panscan', nextCrop ? 1.0 : 0.0);
  };

  const handleStreamSelect = useCallback((stream: any) => {
    prevStreamLinkRef.current = null;
    setSelectedStream(stream);
  }, [setSelectedStream]);

  const showNextBtn = useMemo(() => {
    if (activeEpisodeIndex >= state.episodeList.length - 1) return false;
    if (mpv.duration <= 0) return false;
    return (mpv.currentTime / mpv.duration) > 0.8;
  }, [activeEpisodeIndex, mpv.currentTime, mpv.duration, state.episodeList.length]);

  if (streamLoading) {
    const bgUrl = state.poster?.background || state.poster?.poster;
    return (
      <div className="player-page controls-visible">
        {bgUrl && (
          <>
            <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: -2 }} />
            <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)', zIndex: -1 }} />
          </>
        )}
        <div className="player-loading" style={{ background: bgUrl ? 'transparent' : '#000' }}>
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
            <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: -2 }} />
            <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)', zIndex: -1 }} />
          </>
        )}
        <div className="player-error" style={{ background: bgUrl ? 'transparent' : '#000' }}>
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

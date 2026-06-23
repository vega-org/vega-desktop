import React, { useCallback, useRef } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Rewind,
  FastForward,
  Settings,
  Maximize,
  Minimize,
  SkipForward as NextIcon,
  Subtitles,
  Gauge,
  Volume2 as AudioIcon,
  PictureInPicture,
  RectangleHorizontal,
  Check,
  Server as ServerIcon,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import type { MpvTrack } from '../lib/hooks/useMpvPlayer';
import { SearchSubtitlesModal } from '../components/SearchSubtitlesModal';

interface PlayerControlsProps {
  visible: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  primaryTitle: string;
  secondaryTitle?: string;
  showNextEpisode: boolean;
  onBack: () => void;
  onTogglePause: () => void;
  onSeek: (time: number) => void;
  onSeekRelative: (delta: number) => void;
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
  videoHeight?: number;
  playbackRate: number;
  streamData?: any;
  selectedStream?: any;
  onSelectStream?: (stream: any) => void;
  onSelectAudioTrack: (id: number | 'no' | 'auto') => void;
  onSelectSubtitleTrack: (id: number | 'no' | 'auto') => void;
  onSelectVideoTrack: (id: number | 'no' | 'auto') => void;
  onAddSubtitleFile?: (path: string) => void;
  onPlaybackRateChange: (rate: number) => void;
  onTogglePip: () => void;
  isPip: boolean;
  onToggleCrop: () => void;
  isCropped: boolean;
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function stop(e: React.MouseEvent) { e.stopPropagation(); }

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  visible,
  isPaused,
  isBuffering,
  currentTime,
  duration,
  primaryTitle,
  secondaryTitle,
  showNextEpisode,
  onBack,
  onTogglePause,
  onSeek,
  onSeekRelative,
  onNextEpisode,
  onPrevEpisode,
  hasNextEpisode,
  hasPrevEpisode,
  onToggleFullscreen,
  isFullscreen,
  onClickBackground,
  audioTracks,
  subtitleTracks,
  videoTracks = [],
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
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<'audio' | 'subtitle' | 'speed' | 'quality' | 'server' | null>(null);
  const [showOnlineSearch, setShowOnlineSearch] = useState(false);

  // Close menus when clicking outside
  useEffect(() => {
    const handleDocClick = () => setOpenMenu(null);
    if (openMenu) document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, [openMenu]);

  const toggleMenu = (e: React.MouseEvent, menu: 'audio' | 'subtitle' | 'speed' | 'quality' | 'server') => {
    e.stopPropagation();
    setOpenMenu(openMenu === menu ? null : menu);
  };

  const handleLoadLocalSubtitle = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Subtitles',
          extensions: ['srt', 'vtt', 'ass', 'ssa', 'sub']
        }]
      });
      if (selected && typeof selected === 'string') {
        onAddSubtitleFile?.(selected);
        setOpenMenu(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const seekFromMouse = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!trackRef.current || !duration) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    onSeek((x / rect.width) * duration);
  }, [duration, onSeek]);

  const handleTrackMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    seekFromMouse(e);
    const onMove = (ev: MouseEvent) => seekFromMouse(ev);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [seekFromMouse]);

  if (isPip) {
    const handleDrag = async (e: React.MouseEvent) => {
      if (e.button === 0) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          getCurrentWindow().startDragging();
        } catch (err) {}
      }
    };

    return (
      <>
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'grab' }} onMouseDown={handleDrag} onDoubleClick={onTogglePip} />
        <div className={`player-pip-overlay ${visible ? 'visible' : ''}`} onMouseDown={handleDrag} onDoubleClick={onTogglePip}>
          <div className="player-pip-controls">
            {!isBuffering ? (
              <button className="center-btn play-pause" onClick={onTogglePause} onMouseDown={stop}>
                {isPaused ? <Play size={32} fill="#fff" /> : <Pause size={32} />}
              </button>
            ) : (
              <div className="center-btn play-pause" style={{ cursor: 'default' }} onMouseDown={stop}>
                <div className="loading-spinner" style={{ width: 28, height: 28, borderWidth: 2 }} />
              </div>
            )}
          </div>
          <button className="pip-exit-btn" onClick={onTogglePip} onMouseDown={stop}>
            <Minimize size={16} />
          </button>
        </div>
      </>
    );
  }

  return (
    <div
      className={`player-controls-wrapper ${visible ? 'visible' : ''}`}
      onClick={onClickBackground}
    >
      <div className="controls-gradient-top" />
      <div className="controls-gradient-bottom" />

      {/* Top bar */}
      <div className="player-top-bar" onClick={stop}>
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

      {/* Center play/pause + skip */}
      <div className="player-center-controls" onClick={stop}>
        {hasPrevEpisode && onPrevEpisode ? (
          <button className="center-btn" onClick={onPrevEpisode}>
            <SkipBack size={24} />
          </button>
        ) : <div style={{ width: 44 }} />}
        
        <button className="center-btn" onClick={() => onSeekRelative(-10)}>
          <Rewind size={24} />
        </button>

        {!isBuffering ? (
          <button className="center-btn play-pause" onClick={onTogglePause}>
            {isPaused ? <Play size={32} fill="#fff" /> : <Pause size={32} />}
          </button>
        ) : (
          <div className="center-btn play-pause" style={{ cursor: 'default' }}>
            <div className="loading-spinner" style={{ width: 28, height: 28, borderWidth: 2 }} />
          </div>
        )}
        
        <button className="center-btn" onClick={() => onSeekRelative(10)}>
          <FastForward size={24} />
        </button>

        {hasNextEpisode && onNextEpisode ? (
          <button className="center-btn" onClick={onNextEpisode}>
            <SkipForward size={24} />
          </button>
        ) : <div style={{ width: 44 }} />}
      </div>

      {/* Bottom bar */}
      <div className="player-bottom-bar" onClick={stop}>
        <div className="player-timeline">
          <span className="timeline-time">{formatTime(currentTime)}</span>
          <div ref={trackRef} className="timeline-track" onMouseDown={handleTrackMouseDown}>
            <div className="timeline-progress" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="timeline-time right">{formatTime(duration)}</span>
        </div>

        <div className="player-actions-row">
          <div className="player-actions-left">
            <div className="inline-menu-container">
              <button className={`action-btn text-btn ${openMenu === 'audio' ? 'active' : ''}`} onClick={(e) => toggleMenu(e, 'audio')}>
                <AudioIcon size={18} />
                <span>{audioTracks.find(t => t.selected)?.lang?.toUpperCase().slice(0,2) || 'EN'}</span>
              </button>
              {openMenu === 'audio' && (
                <div className="inline-menu left wide" onClick={stop}>
                  {audioTracks.length === 0 && <div className="inline-menu-item">No audio tracks</div>}
                  {audioTracks.map(t => (
                    <button key={t.id} className={`inline-menu-item ${t.selected ? 'selected' : ''}`} onClick={() => { onSelectAudioTrack(t.id); setOpenMenu(null); }}>
                      <div className="track-details">
                        <span className="track-name">{t.lang ? t.lang.toUpperCase() : `Track ${t.id}`}</span>
                        {t.title && <span className="track-lang">{t.title}</span>}
                      </div>
                      {t.selected && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="inline-menu-container">
              <button className={`action-btn text-btn ${openMenu === 'subtitle' ? 'active' : ''}`} onClick={(e) => toggleMenu(e, 'subtitle')}>
                <Subtitles size={18} />
                <span>{subtitleTracks.find(t => t.selected)?.lang?.toUpperCase().slice(0,2) || 'OFF'}</span>
              </button>
              {openMenu === 'subtitle' && (
                <div className="inline-menu left wide" onClick={stop}>
                  <button className={`inline-menu-item ${!subtitleTracks.some(t => t.selected) ? 'selected' : ''}`} onClick={() => { onSelectSubtitleTrack('no'); setOpenMenu(null); }}>
                    <span>Off</span>
                    {!subtitleTracks.some(t => t.selected) && <Check size={14} />}
                  </button>
                  {subtitleTracks.map(t => (
                    <button key={t.id} className={`inline-menu-item ${t.selected ? 'selected' : ''}`} onClick={() => { onSelectSubtitleTrack(t.id); setOpenMenu(null); }}>
                      <div className="track-details">
                        <span className="track-name">{t.lang ? t.lang.toUpperCase() : `Track ${t.id}`}</span>
                        {t.title && <span className="track-lang">{t.title}</span>}
                      </div>
                      {t.selected && <Check size={14} />}
                    </button>
                  ))}
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
                  <button className="inline-menu-item" onClick={() => setShowOnlineSearch(true)}>
                    <span>Search online...</span>
                  </button>
                  <button className="inline-menu-item" onClick={handleLoadLocalSubtitle}>
                    <span>Load local subtitle...</span>
                  </button>
                </div>
              )}
            </div>

            <div className="inline-menu-container">
              <button className={`action-btn text-btn ${openMenu === 'speed' ? 'active' : ''}`} onClick={(e) => toggleMenu(e, 'speed')}>
                <Gauge size={18} />
                <span>{playbackRate.toFixed(1)}x</span>
              </button>
              {openMenu === 'speed' && (
                <div className="inline-menu left" onClick={stop}>
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(rate => (
                    <button key={rate} className={`inline-menu-item ${Math.abs(playbackRate - rate) < 0.01 ? 'selected' : ''}`} onClick={() => { onPlaybackRateChange(rate); setOpenMenu(null); }}>
                      <span>{rate}x</span>
                      {Math.abs(playbackRate - rate) < 0.01 && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="player-actions-right">
            {showNextEpisode && secondaryTitle && (
              <button className="next-episode-pill" onClick={onNextEpisode}>
                <span>Next: {secondaryTitle}</span>
                <NextIcon size={16} />
              </button>
            )}
            
            <button className={`action-btn text-btn ${isPip ? 'active' : ''}`} onClick={onTogglePip}>
              <PictureInPicture size={18} />
              <span>PIP</span>
            </button>
            
            <div className="inline-menu-container">
              <button className={`action-btn text-btn ${openMenu === 'server' ? 'active' : ''}`} onClick={(e) => toggleMenu(e, 'server')}>
                <ServerIcon size={18} />
                <span>{selectedStream?.server || selectedStream?.quality || 'Server'}</span>
              </button>
              {openMenu === 'server' && (
                <div className="inline-menu right wide" onClick={stop}>
                  {(!streamData || streamData.length === 0) && (
                    <div className="inline-menu-item">No alternative servers</div>
                  )}
                  {streamData?.map((s: any, idx: number) => (
                    <button 
                      key={idx} 
                      className={`inline-menu-item ${(selectedStream?.link === s.link) ? 'selected' : ''}`} 
                      onClick={() => { onSelectStream && onSelectStream(s); setOpenMenu(null); }}
                    >
                      <div className="track-details">
                        <span className="track-name">{s.server || `Server ${idx + 1}`}</span>
                        {s.quality && <span className="track-lang">{s.quality}</span>}
                      </div>
                      {(selectedStream?.link === s.link) && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="inline-menu-container">
              <button className={`action-btn text-btn ${openMenu === 'quality' ? 'active' : ''}`} onClick={(e) => toggleMenu(e, 'quality')}>
                <Settings size={18} />
                <span>{(() => {
                  const sel = videoTracks.find(t => t.selected);
                  if (!sel) return 'Auto';
                  const h = sel.demuxH || (sel.selected ? videoHeight : 0);
                  const fallback = selectedStream?.quality ? selectedStream.quality : (sel.title || sel.codec?.split(' ')[0] || 'Auto');
                  return h ? `${Math.round(h)}p` : fallback;
                })()}</span>
              </button>
              {openMenu === 'quality' && (
                <div className="inline-menu right wide" onClick={stop}>
                  <button className={`inline-menu-item ${!videoTracks.some(t => t.selected) ? 'selected' : ''}`} onClick={() => { onSelectVideoTrack('auto'); setOpenMenu(null); }}>
                    <span>Auto</span>
                    {!videoTracks.some(t => t.selected) && <Check size={14} />}
                  </button>
                  {videoTracks.map(t => {
                    const h = t.demuxH || (t.selected ? videoHeight : 0);
                    const fallback = (t.selected && selectedStream?.quality) ? selectedStream.quality : (t.title || t.codec || `Track ${t.id}`);
                    const primary = h ? `${Math.round(h)}p` : fallback;
                    const secondary = (h || (t.selected && selectedStream?.quality)) ? (t.title || t.codec) : null;
                    return (
                      <button key={t.id} className={`inline-menu-item ${t.selected ? 'selected' : ''}`} onClick={() => { onSelectVideoTrack(t.id); setOpenMenu(null); }}>
                        <div className="track-details">
                          <span className="track-name">{primary}</span>
                          {secondary && <span className="track-lang">{secondary}</span>}
                        </div>
                        {t.selected && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button className={`action-btn text-btn ${isCropped ? 'active' : ''}`} onClick={onToggleCrop}>
              <RectangleHorizontal size={18} />
              <span style={{ display: 'inline-block', minWidth: '32px', textAlign: 'left' }}>
                {isCropped ? 'Crop' : 'Fit'}
              </span>
            </button>
            
            <button className="action-btn text-btn" onClick={onToggleFullscreen}>
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>
      
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

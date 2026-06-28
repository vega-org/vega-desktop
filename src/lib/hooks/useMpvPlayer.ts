import { useEffect, useRef, useState, useCallback } from 'react';
import {
  init,
  destroy,
  command,
  setProperty,
  getProperty,
  observeProperties,
  listenEvents,
  type MpvObservableProperty,
} from 'tauri-plugin-libmpv-api';
import { settingsStorage } from '../storage/SettingsStorage';
import { useExternalMpv } from './useExternalMpv';

const OBSERVED_PROPERTIES = [
  ['pause', 'flag'],
  ['time-pos', 'double', 'none'],
  ['duration', 'double', 'none'],
  ['volume', 'double'],
  ['speed', 'double'],
  ['eof-reached', 'flag'],
  ['paused-for-cache', 'flag'],
  ['track-list/count', 'int64'],
  ['video-params/h', 'double'],
] as const satisfies MpvObservableProperty[];

export interface MpvTrack {
  id: number;
  type: 'audio' | 'video' | 'sub';
  title: string;
  lang: string;
  codec: string;
  selected: boolean;
  external: boolean;
  demuxW?: number;
  demuxH?: number;
}

// Global state to prevent StrictMode race conditions
let globalInitPromise: Promise<void> | null = null;
let globalDestroyTimer: NodeJS.Timeout | null = null;
let activeInstances = 0;
let destroyPromise: Promise<void> | null = null;

export interface UseMpvPlayerOptions {
  onEof?: () => void;
  onFileLoaded?: () => void;
}

const useEmbeddedMpv = (opts?: UseMpvPlayerOptions) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1.0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [tracks, setTracks] = useState<MpvTrack[]>([]);
  const [videoHeight, setVideoHeight] = useState(0);

  const unlistenPropsRef = useRef<(() => void) | null>(null);
  const unlistenEventsRef = useRef<(() => void) | null>(null);
  const pendingSubsRef = useRef<{url?: string, uri?: string, language?: string, title?: string}[]>([]);
  const optsRef = useRef(opts);
  const initCounterRef = useRef(0);
  optsRef.current = opts;

  // ... fetchTracks is unchanged ...
  const fetchTracks = useCallback(async () => {
    try {
      const count = await getProperty('track-list/count', 'int64') as number;
      if (!count || count <= 0) return;

      const parsed: MpvTrack[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const type = await getProperty(`track-list/${i}/type`, 'string') as string;
          const id = await getProperty(`track-list/${i}/id`, 'int64') as number;
          const title = await getProperty(`track-list/${i}/title`, 'string').catch(() => '') as string;
          const lang = await getProperty(`track-list/${i}/lang`, 'string').catch(() => '') as string;
          const codec = await getProperty(`track-list/${i}/codec`, 'string').catch(() => '') as string;
          const selected = await getProperty(`track-list/${i}/selected`, 'flag').catch(() => false) as boolean;
          const external = await getProperty(`track-list/${i}/external`, 'flag').catch(() => false) as boolean;
          const demuxW = await getProperty(`track-list/${i}/demux-w`, 'int64').catch(() => undefined) as number | undefined;
          const demuxH = await getProperty(`track-list/${i}/demux-h`, 'int64').catch(() => undefined) as number | undefined;

          parsed.push({
            id,
            type: type as MpvTrack['type'],
            title: title || '',
            lang: lang || '',
            codec: codec || '',
            selected: selected || false,
            external: external || false,
            demuxW,
            demuxH,
          });
        } catch (err) { }
      }
      setTracks(parsed);
    } catch (err: any) {
      if (String(err).includes('instance not found')) return;
      console.error('Failed to fetch tracks:', err);
    }
  }, []);

  const initPlayer = useCallback(async () => {
    activeInstances++;
    initCounterRef.current++;
    const currentInit = initCounterRef.current;

    if (globalDestroyTimer) {
      clearTimeout(globalDestroyTimer);
      globalDestroyTimer = null;
    }

    if (destroyPromise) {
      await destroyPromise;
    }

    if (!globalInitPromise) {
      globalInitPromise = (async () => {
        try {
          const hwAccel = settingsStorage.isHardwareAccelerationEnabled();
          const initialOptions: Record<string, string> = {
            'keep-open': 'yes',
            'force-window': 'no',
            'osd-level': '0',
            'sub-auto': 'fuzzy',
            'sub-font-size': (settingsStorage.getSubtitleFontSize() || 36).toString(),
            'sub-border-size': '2',
            'sub-shadow-offset': '1',
            'sub-margin-y': (settingsStorage.getSubtitleBottomPadding() || 36).toString(),
            'sub-ass-override': 'force',
            'demuxer-lavf-o': 'fflags=+genpts',
          };

          if (hwAccel) {
            initialOptions['vo'] = 'gpu-next';
            initialOptions['hwdec'] = 'auto-safe';
          }

          await init({
            initialOptions,
            observedProperties: OBSERVED_PROPERTIES,
          });
        } catch (err) {
          console.error('Failed to initialize mpv:', err);
          globalInitPromise = null;
          throw err;
        }
      })();
    }

    await globalInitPromise;

    if (currentInit !== initCounterRef.current) return;

    try {
      const unlisten = await observeProperties(
        OBSERVED_PROPERTIES,
        ({ name, data }) => {
          switch (name) {
            case 'pause':
              setIsPaused(data as boolean);
              break;
            case 'time-pos':
              if (data !== null) setCurrentTime(data as number);
              break;
            case 'duration':
              if (data !== null) setDuration(data as number);
              break;
            case 'volume':
              setVolume(data as number);
              break;
            case 'speed':
              setSpeed(data as number);
              break;
            case 'eof-reached':
              if (data === true) optsRef.current?.onEof?.();
              break;
            case 'paused-for-cache':
              setIsBuffering(data as boolean);
              break;
            case 'track-list/count':
              fetchTracks();
              break;
            case 'video-params/h':
              if (data !== null) setVideoHeight(data as number);
              break;
          }
        }
      );
      
      if (currentInit !== initCounterRef.current) {
        unlisten();
        return;
      }
      unlistenPropsRef.current = unlisten;

      const unlistenEvt = await listenEvents((event) => {
        if (event.event === 'file-loaded') {
          console.log('mpv: file-loaded');
          setIsBuffering(false);
          getProperty('pause', 'flag').then(p => setIsPaused(p as boolean)).catch(() => { });
          
          if (optsRef.current?.onFileLoaded) {
            optsRef.current.onFileLoaded();
          }

          if (pendingSubsRef.current && pendingSubsRef.current.length > 0) {
            setTimeout(async () => {
              for (const sub of pendingSubsRef.current) {
                let subUrl = sub.uri || sub.url;
                if (subUrl) {
                  subUrl = subUrl.replace(/\\/g, '/');
                  try {
                    await command('sub-add', [subUrl, 'auto', sub.title || sub.language || 'External']);
                  } catch (e) {
                    console.error('Failed to add sub:', e);
                  }
                }
              }
              pendingSubsRef.current = [];
              setTimeout(fetchTracks, 1000);
            }, 500);
          }
        }
        if (event.event === 'seek') {
          setIsBuffering(true);
        }
        if (event.event === 'playback-restart') {
          setIsBuffering(false);
          getProperty('pause', 'flag').then(p => setIsPaused(p as boolean)).catch(() => { });
        }
        if (event.event === 'end-file') {
          console.log('mpv: end-file', event);
          setIsBuffering(false);
        }
      });
      
      if (currentInit !== initCounterRef.current) {
        unlistenEvt();
        return;
      }
      unlistenEventsRef.current = unlistenEvt;

      setIsInitialized(true);
      console.log('mpv: initialized');
    } catch (err) {
      console.error('Failed to attach listeners:', err);
    }
  }, [fetchTracks]);

  const destroyPlayer = useCallback(() => {
    initCounterRef.current++;
    activeInstances--;
    unlistenPropsRef.current?.();
    unlistenEventsRef.current?.();
    unlistenPropsRef.current = null;
    unlistenEventsRef.current = null;
    setIsInitialized(false);

    if (activeInstances <= 0) {
      // Debounce destroy to handle StrictMode unmount/remount
      globalDestroyTimer = setTimeout(() => {
        destroyPromise = (async () => {
          try {
            await destroy();
            console.log('mpv: destroyed');
          } catch (err) {
            console.error('Failed to destroy mpv:', err);
          } finally {
            globalInitPromise = null;
            destroyPromise = null;
          }
        })();
      }, 500);
    } else {
      try {
        command('stop').catch(() => { });
      } catch { }
    }
  }, []);

  const loadFile = useCallback(async (url: string, headers?: Record<string, string>, subtitles?: any[]) => {
    if (!isInitialized) return;
    setIsBuffering(true);
    setTracks([]);
    pendingSubsRef.current = subtitles || [];
    try {
      let ua = '';
      let referer = '';

      if (headers && Object.keys(headers).length > 0) {
        const headerList: string[] = [];
        for (const [k, v] of Object.entries(headers)) {
          const lowerK = k.toLowerCase();
          if (lowerK === 'user-agent') {
            ua = v;
          } else if (lowerK === 'referer') {
            referer = v;
          }
          
          let val = `${k}: ${v}`;
          if (val.includes(',')) {
            val = `"${val.replace(/"/g, '\\"')}"`;
          }
          headerList.push(val);
        }
        
        await setProperty('http-header-fields', headerList.join(',')).catch(e => console.error('Failed to set headers:', e));
      } else {
        await setProperty('http-header-fields', '').catch(() => {});
      }

      let finalUrl = url;
      if (url.startsWith('http')) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const port = await invoke<number | null>('get_stream_proxy_port');
          console.log('[MPV proxy] port:', port);
          if (port) {
            let proxyUrl = `http://127.0.0.1:${port}/proxy?url=${encodeURIComponent(url)}`;
            if (referer) {
              proxyUrl += `&referer=${encodeURIComponent(referer)}`;
            }
            if (ua) {
              proxyUrl += `&ua=${encodeURIComponent(ua)}`;
            }
            finalUrl = proxyUrl;
          }
        } catch (e) {
          console.error('Failed to get proxy port:', e);
        }
      }

      await setProperty('user-agent', ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36').catch(console.error);
      if (referer) {
        await setProperty('referrer', referer).catch(console.error);
      } else {
        await setProperty('referrer', '').catch(console.error);
      }
      console.log('[MPV loadFile] finalUrl:', finalUrl);
      await command('loadfile', [finalUrl]);
    } catch (err: any) {
      if (String(err).includes('instance not found')) return;
      console.error('Failed to load file:', err);
      setIsBuffering(false);
    }
  }, [isInitialized]);

  const togglePause = useCallback(async () => {
    if (!isInitialized) return;
    try {
      await command('cycle', ['pause']);
    } catch (err: any) {
      if (String(err).includes('instance not found')) return;
      console.error('Failed to toggle pause:', err);
    }
  }, [isInitialized]);

  const seek = useCallback(async (timeSeconds: number, mode: 'absolute' | 'relative' = 'absolute') => {
    if (!isInitialized) return;
    try {
      await command('seek', [timeSeconds, mode]);
    } catch (err: any) {
      if (String(err).includes('instance not found')) return;
      console.error('Failed to seek:', err);
    }
  }, [isInitialized]);

  const setVolumeLevel = useCallback(async (level: number) => {
    if (!isInitialized) return;
    try {
      const vol = Math.max(0, Math.min(150, level));
      await setProperty('volume', vol.toString());
    } catch (err) {
      console.error('Failed to set volume:', err);
    }
  }, [isInitialized]);

  const setPlaybackSpeed = useCallback(async (rate: number) => {
    if (!isInitialized) return;
    try {
      await setProperty('speed', rate.toString());
    } catch (err) {
      console.error('Failed to set speed:', err);
    }
  }, [isInitialized]);

  const selectTrack = useCallback(async (type: 'aid' | 'sid' | 'vid', id: number | 'no' | 'auto') => {
    if (!isInitialized) return;
    try {
      if (id === 'no' || id === 'auto') {
        await setProperty(type, id);
      } else {
        await setProperty(type, id.toString());
      }
      setTimeout(fetchTracks, 200);
    } catch (err) {
      console.error(`Failed to set ${type}:`, err);
    }
  }, [isInitialized, fetchTracks]);

  const addSubtitleFile = useCallback(async (url: string, title?: string) => {
    if (!isInitialized) return;
    try {
      await command('sub-add', [url, 'auto', title || 'External']);
      setTimeout(fetchTracks, 1000);
    } catch (err) {
      console.error('Failed to add subtitle:', err);
    }
  }, [isInitialized, fetchTracks]);

  const updateSubtitleSettings = useCallback(async () => {
    if (!isInitialized) return;
    try {
      const size = settingsStorage.getSubtitleFontSize() || 36;
      const margin = settingsStorage.getSubtitleBottomPadding() || 36;
      const outlineSize = settingsStorage.getSubtitleOutlineSize() ?? 2;
      const weight = settingsStorage.getSubtitleFontWeight() ?? 400;
      const baseFontFamily = settingsStorage.getSubtitleFontFamily() || 'sans-serif';
      
      let fontName = baseFontFamily;
      let isBold = 'no';
      
      // If the user selected the default sans-serif or Segoe UI, we can use specific Segoe UI variants
      // to achieve accurate font weights on Windows.
      if (baseFontFamily === 'sans-serif' || baseFontFamily === 'Segoe UI') {
        if (weight <= 300) {
          fontName = 'Segoe UI Light';
        } else if (weight === 600) {
          fontName = 'Segoe UI Semibold';
        } else if (weight === 700) {
          isBold = 'yes';
        } else if (weight >= 800) {
          fontName = 'Segoe UI Black';
        } else {
          fontName = baseFontFamily;
        }
      } else {
        // For other custom fonts, just rely on native bolding if weight >= 600
        if (weight >= 600) isBold = 'yes';
      }
      
      await setProperty('sub-font', fontName).catch(() => {});
      await setProperty('sub-bold', isBold).catch(() => {});
      await setProperty('sub-font-size', size.toString()).catch(() => {});
      await setProperty('sub-margin-y', margin.toString()).catch(() => {});
      await setProperty('sub-ass-override', 'force').catch(() => {});
      await setProperty('sub-color', '#FFFFFFFF').catch(() => {});
      await setProperty('sub-border-size', outlineSize.toString()).catch(() => {});
      await setProperty('sub-shadow-offset', '1').catch(() => {});
      await setProperty('sub-border-color', '#FF000000').catch(() => {});
      await setProperty('sub-border-style', 'outline-and-shadow').catch(() => {});
      
      // Clear out background color properties just in case
      await setProperty('sub-back-color', '#00000000').catch(() => {});
      await setProperty('sub-bg-color', '#00000000').catch(() => {});
      
    } catch (err) {
      console.error('Failed to update subtitle settings:', err);
    }
  }, [isInitialized]);

  useEffect(() => {
    return () => {
      unlistenPropsRef.current?.();
      unlistenEventsRef.current?.();
    };
  }, []);

  const audioTracks = tracks.filter(t => t.type === 'audio');
  const subtitleTracks = tracks.filter(t => t.type === 'sub');
  const videoTracks = tracks.filter(t => t.type === 'video');

  return {
    isInitialized,
    isPaused,
    currentTime,
    duration,
    volume,
    speed,
    isBuffering,
    tracks,
    videoHeight,
    videoTracks,
    audioTracks,
    subtitleTracks,
    initPlayer,
    destroyPlayer,
    loadFile,
    togglePause,
    seek,
    setVolumeLevel,
    setPlaybackSpeed,
    selectTrack,
    addSubtitleFile,
    updateSubtitleSettings,
    fetchTracks,
    setProperty: async (prop: string, val: any) => { if (isInitialized) { try { await setProperty(prop, val); } catch (e) { } } },
  };
};

// Delegate to the external-mpv backend on Linux (Docker / X11) where the
// embedded libmpv renderer cannot bind to the WebKitGTK compositor surface.
// Windows and macOS continue to use the full embedded implementation above.
const IS_LINUX =
  typeof navigator !== 'undefined' &&
  navigator.userAgent.includes('Linux') &&
  !navigator.userAgent.includes('Android');

export const useMpvPlayer = IS_LINUX ? useExternalMpv : useEmbeddedMpv;

import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {isTauriRuntime} from "../../platform/host";
import type {LibmediaPlayerAdapter} from "../player/LibmediaPlayerAdapter";
import type {PlayerEngine} from "../player/PlayerEngine";
import { HtmlVideoEngine } from "../player/HtmlVideoEngine";
import {getLibmediaRuntimeError} from '../player/libmediaRuntime';
import type { PlayerEngineOptions, PlayerEngineState } from "../player/PlayerEngine";

export interface UsePlayerEngineOptions {
  onEof?: () => void;
  onFileLoaded?: () => void;
  onError?: (error: string) => void;
}

type VideoRefType =
  | React.RefObject<HTMLVideoElement | null>
  | React.MutableRefObject<HTMLVideoElement | null>
  | ((node: HTMLVideoElement | null) => void)
  | HTMLVideoElement
  | null;

export function usePlayerEngine(
  videoRef?: VideoRefType,
  opts?: UsePlayerEngineOptions,
  requestedEngineKind: "builtin" | "libmedia" | "drm" = "builtin",
) {
  const engineKind = requestedEngineKind === "drm"
    ? "builtin"
    : import.meta.env.VITE_TV_HOST ? "libmedia" : requestedEngineKind;
  const runtimeError = engineKind === 'libmedia' ? getLibmediaRuntimeError() : null;
  const libmediaAdapterRef=useRef<typeof LibmediaPlayerAdapter|null>(null);
  const [libmediaReady,setLibmediaReady]=useState(false);
  useEffect(()=>{
    if(engineKind!=="libmedia")return;
    if(runtimeError){
      setInitError(runtimeError);
      setEngineState(previous=>({...previous,error:runtimeError,isBuffering:false,isPaused:true}));
      return;
    }
    let active=true;
    void import('../player/LibmediaPlayerAdapter').then(module=>{
      if(active){libmediaAdapterRef.current=module.LibmediaPlayerAdapter;setLibmediaReady(true);}
    }).catch(error=>{if(active)setInitError(error?.message||'Libmedia is unavailable on this device');});
    return ()=>{active=false;};
  },[engineKind,runtimeError]);
  const [engineState, setEngineState] = useState<PlayerEngineState>({
    isInitialized: true,
    isPaused: true,
    currentTime: 0,
    duration: 0,
    volume: 100,
    speed: 1.0,
    isBuffering: false,
    cacheDuration: 0,
    tracks: [],
    audioTracks: [],
    subtitleTracks: [],
    videoTracks: [],
    chapters: [],
    videoHeight: 0,
    error: null,
    audioDelay: 0,
    subtitleDelay: 0,
  });

  const [initError, setInitError] = useState<string | null>(null);
  const lastReportedErrorRef = useRef<string | null>(null);

  const [videoNode, setVideoNode] = useState<HTMLVideoElement | null>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const engineVideoRef = useRef<HTMLVideoElement | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const currentSpeedRef = useRef<number>(1.0);

  const pendingLoadRef = useRef<{
    source: string;
    headers?: Record<string, string>;
    subtitles?: { url?: string; uri?: string; language?: string; title?: string }[];
    streamType?: string;
    drm?: PlayerEngineOptions["drm"];
    localBaseDir?: string;
    speed?: number;
  } | null>(null);

  const protectedStreamRef = useRef(false);
  const thumbnailSourceRef = useRef<{
    source: string;
    headers?: Record<string, string>;
  } | null>(null);

  const pendingSeekTargetRef = useRef<number | null>(null);
  const seekDebounceTimerRef = useRef<any>(null);

  const resolveVideoElement = useCallback((): HTMLVideoElement | null => {
    if (videoRef && typeof videoRef === "object" && "current" in videoRef) {
      return videoRef.current;
    }
    if (videoRef instanceof HTMLVideoElement) {
      return videoRef;
    }
    return videoNode;
  }, [videoNode, videoRef]);

  const bindVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      if (typeof videoRef === "function") {
        videoRef(node);
      } else if (videoRef && typeof videoRef === "object" && "current" in videoRef) {
        (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = node;
      }
      setVideoNode(node);
    },
    [videoRef],
  );

  const setupEngine = useCallback((el: HTMLVideoElement): PlayerEngine | null => {
    const libmediaAdapter=libmediaAdapterRef.current;
    if(engineKind==='libmedia'&&!libmediaAdapter)return null;
    if (engineRef.current) {
      if (engineVideoRef.current === el) return engineRef.current;
      engineRef.current.destroy();
      engineRef.current = null;
    }

    try {
      const engine = engineKind === "libmedia" ? new libmediaAdapter!(el) : new HtmlVideoEngine(el);
      engineRef.current = engine;
      engineVideoRef.current = el;
      setInitError(null);
      if (currentSpeedRef.current !== 1.0) {
        engine.setSpeed(currentSpeedRef.current);
      }

      engine.subscribe((next) => {
        setEngineState(next);
        if (
          optsRef.current?.onEof &&
          next.duration > 0 &&
          Math.abs(next.currentTime - next.duration) < 0.5
        ) {
          optsRef.current.onEof();
        }
        if (next.error && next.error !== lastReportedErrorRef.current) {
          lastReportedErrorRef.current = next.error;
          optsRef.current?.onError?.(next.error);
        } else if (!next.error) {
          lastReportedErrorRef.current = null;
        }
      });

      if (pendingLoadRef.current) {
        const pending = pendingLoadRef.current;
        pendingLoadRef.current = null;
        thumbnailSourceRef.current = {
          source: pending.source,
          headers: pending.headers,
        };
        lastReportedErrorRef.current = null;
        console.log("[usePlayerEngine] Executing queued load for:", pending.source);
        engine
          .load(pending.source, {
            headers: pending.headers,
            streamType: pending.streamType,
            drm: pending.drm,
            subtitles: pending.subtitles,
            autoPlay: true,
            speed: pending.speed || currentSpeedRef.current,
          })
          .then(() => {
            optsRef.current?.onFileLoaded?.();
          })
          .catch((e) => {
            console.error("[usePlayerEngine] Failed to load queued stream:", e);
            const msg = e?.message || "Failed to load stream";
            if (msg !== lastReportedErrorRef.current) {
              lastReportedErrorRef.current = msg;
              optsRef.current?.onError?.(msg);
            }
          });
      }

      return engine;
    } catch (err: any) {
      console.error("[usePlayerEngine] Failed to initialize video engine:", err);
      const msg = err?.message || "Failed to initialize player";
      setInitError(msg);
      return null;
    }
  }, [engineKind]);

  useEffect(() => {
    const el = resolveVideoElement();
    if (!el) return;

    setupEngine(el);
  }, [resolveVideoElement, setupEngine,libmediaReady]);

  // Resolving a ref can rerun setup for the same element. Only dispose on
  // unmount or a change of engine/ref ownership, not that state update.
  useEffect(() => {
    return () => {
      if (seekDebounceTimerRef.current) {
        clearTimeout(seekDebounceTimerRef.current);
        seekDebounceTimerRef.current = null;
      }
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
        engineVideoRef.current = null;
      }
    };
  }, [setupEngine, videoRef]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let wakeLock: any = null;
    let isReleased = false;

    const requestLock = async () => {
      try {
        if (!engineState.isPaused && !wakeLock && !isReleased) {
          wakeLock = await (navigator as any).wakeLock.request("screen");
          wakeLock.addEventListener?.("release", () => {
            wakeLock = null;
          });
        }
      } catch {}
    };

    const releaseLock = async () => {
      try {
        if (wakeLock) {
          await wakeLock.release();
          wakeLock = null;
        }
      } catch {}
    };

    if (!engineState.isPaused) {
      requestLock();
    } else {
      releaseLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !engineState.isPaused) {
        requestLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isReleased = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseLock();
    };
  }, [engineState.isPaused]);

  const loadFile = useCallback(
    async (
      source: string,
      headers?: Record<string, string>,
      subtitles?: { url?: string; uri?: string; language?: string; title?: string }[],
      streamType?: string,
      localBaseDir?: string,
      drm?: PlayerEngineOptions["drm"],
    ) => {
      if (runtimeError) return;
      protectedStreamRef.current = Boolean(drm);
      thumbnailSourceRef.current = { source, headers };
      let engine = engineRef.current;
      if (!engine) {
        const el = resolveVideoElement();
        if (el) {
          engine = setupEngine(el);
        }
      }

      if (!engine) {
        console.log("[usePlayerEngine] Video element not yet mounted, queueing stream:", source);
        pendingLoadRef.current = {
          source,
          headers,
          subtitles,
          streamType,
          drm,
          localBaseDir,
          speed: currentSpeedRef.current,
        };
        return;
      }

      lastReportedErrorRef.current = null;
      try {
        await engine.load(source, {
          headers,
          streamType,
          drm,
          subtitles,
          autoPlay: true,
          speed: currentSpeedRef.current,
        });
        optsRef.current?.onFileLoaded?.();
      } catch (e: any) {
        console.error("[usePlayerEngine] Failed to load stream:", e);
        const msg = e?.message || "Failed to load stream";
        if (msg !== lastReportedErrorRef.current) {
          lastReportedErrorRef.current = msg;
          optsRef.current?.onError?.(msg);
        }
      }
    },
    [resolveVideoElement, setupEngine, runtimeError],
  );

  const togglePause = useCallback(async () => {
    if (!engineRef.current) return;
    const currentState = engineRef.current.state;
    if (currentState.isPaused) {
      await engineRef.current.play();
    } else {
      engineRef.current.pause();
    }
  }, []);

  const seek = useCallback(
    async (time: number, mode?: "absolute" | "relative") => {
      if (!engineRef.current) return;
      const currentState = engineRef.current.state;
      const duration = currentState.duration || 0;

      let target: number;
      if (mode === "relative") {
        const base =
          pendingSeekTargetRef.current !== null
            ? pendingSeekTargetRef.current
            : currentState.currentTime;
        target = Math.max(
          0,
          duration > 0 ? Math.min(base + time, duration) : Math.max(0, base + time),
        );
        pendingSeekTargetRef.current = target;
      } else {
        target = Math.max(0, duration > 0 ? Math.min(time, duration) : time);
        pendingSeekTargetRef.current = target;
      }

      setEngineState((prev) => ({ ...prev, currentTime: target }));

      if (seekDebounceTimerRef.current) {
        clearTimeout(seekDebounceTimerRef.current);
      }

      seekDebounceTimerRef.current = setTimeout(async () => {
        seekDebounceTimerRef.current = null;
        const finalTarget = pendingSeekTargetRef.current;
        pendingSeekTargetRef.current = null;
        if (finalTarget !== null && engineRef.current) {
          await engineRef.current.seek(finalTarget);
        }
      }, 40);
    },
    [],
  );

  const setVolumeLevel = useCallback(async (volume: number) => {
    if (!engineRef.current) return;
    engineRef.current.setVolume(volume);
  }, []);

  const setPlaybackSpeed = useCallback(async (speed: number) => {
    currentSpeedRef.current = speed;
    setEngineState((prev) => ({ ...prev, speed }));
    if (!engineRef.current) return;
    engineRef.current.setSpeed(speed);
  }, []);

  const selectTrack = useCallback(
    async (type: "aid" | "sid" | "vid", id: number | "no" | "auto") => {
      if (!engineRef.current) return;
      await engineRef.current.selectTrack(type, id);
    },
    [],
  );

  const addSubtitleFile = useCallback(async (path: string, title?: string) => {
    if (!engineRef.current) return;
    await engineRef.current.addSubtitleFile?.(path, title);
  }, []);

  const setExternalSubtitles = useCallback(
    (subs: { url?: string; uri?: string; language?: string; title?: string }[]) => {
      engineRef.current?.setExternalSubtitles?.(subs);
    },
    [],
  );

  const setAudioDelay = useCallback(async (delayMs: number) => {
    if (!engineRef.current) return;
    await engineRef.current.setAudioDelay?.(delayMs);
  }, []);

  const setSubtitleDelay = useCallback(async (delayMs: number) => {
    if (!engineRef.current) return;
    await engineRef.current.setSubtitleDelay?.(delayMs);
  }, []);

  const requestThumbnail = useCallback(
    async (time: number, sourceUrl?: string, headers?: Record<string, string>) => {
      if (!isTauriRuntime() || protectedStreamRef.current) return null;
      const activeSource =
        sourceUrl ||
        thumbnailSourceRef.current?.source ||
        engineRef.current?.source;
      const activeHeaders =
        headers ||
        thumbnailSourceRef.current?.headers ||
        engineRef.current?.headers;

      if (!activeSource || !Number.isFinite(time)) return null;
      try {
        const result = await invoke<string>("generate_video_thumbnail", {
          source: activeSource,
          timestamp: Math.max(0, time),
          headers: activeHeaders || null,
        });
        return result;
      } catch (e) {
        console.debug("Thumbnail preview unavailable:", e);
        return null;
      }
    },
    [],
  );

  const updateSubtitleSettings = useCallback(async () => {
    if (!engineRef.current) return;
    await engineRef.current.updateSubtitleSettings?.();
  }, []);

  return {
    isInitialized: engineState.isInitialized && !initError && !runtimeError,
    initializationError: runtimeError || initError,
    playbackError: engineState.error,
    error: engineState.error,
    isPaused: engineState.isPaused,
    currentTime: engineState.currentTime,
    duration: engineState.duration,
    volume: engineState.volume,
    speed: engineState.speed,
    isBuffering: engineState.isBuffering,
    cacheDuration: engineState.cacheDuration,
    tracks: engineState.tracks,
    chapters: engineState.chapters,
    videoHeight: engineState.videoHeight,
    videoTracks: engineState.videoTracks,
    audioTracks: engineState.audioTracks,
    subtitleTracks: engineState.subtitleTracks,
    audioDelay: engineState.audioDelay || 0,
    subtitleDelay: engineState.subtitleDelay || 0,
    bindVideo,
    loadFile,
    requestThumbnail,
    togglePause,
    seek,
    setVolumeLevel,
    setPlaybackSpeed,
    selectTrack,
    addSubtitleFile,
    setExternalSubtitles,
    setAudioDelay,
    setSubtitleDelay,
    updateSubtitleSettings,
    initPlayer: async () => {
      if (runtimeError) return;
      setInitError(null);
      setEngineState((prev) => ({ ...prev, isInitialized: true }));
      const el = resolveVideoElement();
      if (el && !engineRef.current) {
        setupEngine(el);
      }
    },
    destroyPlayer: async () => {
      if (seekDebounceTimerRef.current) {
        clearTimeout(seekDebounceTimerRef.current);
        seekDebounceTimerRef.current = null;
      }
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    },
    setProperty: async (prop: string, val: any) => {await engineRef.current?.setProperty?.(prop,val);},
  };
}

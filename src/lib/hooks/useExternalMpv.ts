/**
 * useExternalMpv
 *
 * Linux-only playback backend.  Instead of rendering video inside the Tauri
 * WebView (which requires Vulkan / a raw XID surface that is unavailable in
 * Docker/X11 environments), this hook spawns an external `mpv` process via
 * the `launch_mpv` Tauri command and lets mpv manage its own fullscreen
 * window.
 *
 * The return shape is intentionally identical to the one produced by
 * `useMpvPlayer` so that `PlayerPage.tsx` and every other consumer require
 * zero changes.
 *
 * Playback-state properties (currentTime, duration, isPaused …) are stubs
 * because there is no IPC channel to the external process in Phase 1.
 * A future phase could add `--input-ipc-server=/tmp/mpv.sock` support to
 * enable seek, pause, and progress tracking.
 */
import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Inline the shared types to avoid a circular import with useMpvPlayer.ts.
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

export interface UseMpvPlayerOptions {
  onEof?: () => void;
  onFileLoaded?: () => void;
}

const EMPTY_TRACKS: MpvTrack[] = [];

export const useExternalMpv = (_opts?: UseMpvPlayerOptions) => {
  const [isBuffering, setIsBuffering] = useState(false);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  // External mpv needs no async initialisation; mark ready immediately.
  const initPlayer = useCallback(async () => {}, []);
  const destroyPlayer = useCallback(() => {}, []);

  // ── Core playback ─────────────────────────────────────────────────────────
  const loadFile = useCallback(
    async (
      url: string,
      headers?: Record<string, string>,
      _subtitles?: unknown[],
    ) => {
      setIsBuffering(true);
      try {
        await invoke<void>('launch_mpv', { url, headers: headers ?? {} });
      } catch (err) {
        console.error('[useExternalMpv] launch_mpv failed:', err);
      } finally {
        setIsBuffering(false);
      }
    },
    [],
  );

  // ── No-op stubs ───────────────────────────────────────────────────────────
  // These match the signatures expected by PlayerControls / PlayerPage so
  // the controls overlay compiles and renders without modification.  They
  // are silent no-ops because mpv handles its own controls when running
  // fullscreen externally.
  const togglePause = useCallback(async () => {}, []);
  const seek = useCallback(
    async (_t: number, _mode?: 'absolute' | 'relative') => {},
    [],
  );
  const setVolumeLevel = useCallback(async (_level: number) => {}, []);
  const setPlaybackSpeed = useCallback(async (_rate: number) => {}, []);
  const selectTrack = useCallback(
    async (
      _type: 'aid' | 'sid' | 'vid',
      _id: number | 'no' | 'auto',
    ) => {},
    [],
  );
  const addSubtitleFile = useCallback(
    async (_url: string, _title?: string) => {},
    [],
  );
  const fetchTracks = useCallback(async () => {}, []);
  const updateSubtitleSettings = useCallback(async () => {}, []);
  const setProperty = useCallback(
    async (_prop: string, _val: unknown) => {},
    [],
  );

  // ── Return value (same shape as useMpvPlayer) ─────────────────────────────
  return {
    // State
    isInitialized: true,
    isPaused: false,
    currentTime: 0,
    duration: 0,
    volume: 100,
    speed: 1.0,
    isBuffering,
    tracks: EMPTY_TRACKS,
    videoHeight: 0,
    videoTracks: EMPTY_TRACKS,
    audioTracks: EMPTY_TRACKS,
    subtitleTracks: EMPTY_TRACKS,

    // Lifecycle
    initPlayer,
    destroyPlayer,

    // Playback
    loadFile,
    togglePause,
    seek,
    setVolumeLevel,
    setPlaybackSpeed,

    // Track management
    selectTrack,
    addSubtitleFile,
    fetchTracks,

    // Settings
    updateSubtitleSettings,
    setProperty,
  };
};

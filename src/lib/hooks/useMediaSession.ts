import { useEffect, useRef } from "react";

interface UseMediaSessionOptions {
  enabled: boolean;
  title: string;
  artist?: string;
  album?: string;
  artwork?: string[];
  isPaused: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  onTogglePause: () => void;
  onSeek: (position: number) => void;
  onSeekRelative: (offset: number) => void;
  onNext?: () => void;
  onPrevious?: () => void;
}

const getMediaSession = () =>
  typeof navigator !== "undefined" && "mediaSession" in navigator
    ? navigator.mediaSession
    : null;

const createSilentAudioUrl = () => {
  // MPV renders outside the WebView, so Chromium needs an inaudible media
  // element before it will publish navigator.mediaSession to the OS.
  const sampleRate = 8_000;
  const durationSeconds = 30;
  const dataSize = sampleRate * durationSeconds;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  const samples = new Uint8Array(buffer, 44);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 18 < 9 ? 127 : 129;
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
};

export const useMediaSession = ({
  enabled,
  title,
  artist,
  album,
  artwork = [],
  isPaused,
  currentTime,
  duration,
  playbackRate,
  onTogglePause,
  onSeek,
  onSeekRelative,
  onNext,
  onPrevious,
}: UseMediaSessionOptions) => {
  const carrierRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!getMediaSession() || typeof Audio === "undefined") return;

    const sourceUrl = createSilentAudioUrl();
    const carrier = new Audio(sourceUrl);
    carrier.loop = true;
    carrier.preload = "auto";
    carrier.volume = 0.001;
    carrier.load();
    carrierRef.current = carrier;

    return () => {
      carrier.pause();
      carrier.removeAttribute("src");
      carrier.load();
      URL.revokeObjectURL(sourceUrl);
      carrierRef.current = null;
    };
  }, []);

  useEffect(() => {
    const carrier = carrierRef.current;
    if (!carrier) return;

    if (!enabled) {
      carrier.pause();
      carrier.currentTime = 0;
      return;
    }

    if (isPaused) {
      carrier.pause();
      return;
    }

    let cancelled = false;
    const resume = () => {
      if (!cancelled) void carrier.play().catch(() => {});
    };

    void carrier.play().catch(() => {
      if (cancelled) return;
      window.addEventListener("pointerdown", resume, {
        capture: true,
        once: true,
      });
      window.addEventListener("keydown", resume, {
        capture: true,
        once: true,
      });
    });

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", resume, true);
      window.removeEventListener("keydown", resume, true);
    };
  }, [enabled, isPaused]);

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (!enabled || !mediaSession || typeof MediaMetadata === "undefined") {
      return;
    }

    mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: artwork.filter(Boolean).map((src) => ({ src })),
    });

    return () => {
      mediaSession.metadata = null;
    };
  }, [album, artist, artwork, enabled, title]);

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (!enabled || !mediaSession) return;

    const registeredActions: MediaSessionAction[] = [];
    const register = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler,
    ) => {
      try {
        mediaSession.setActionHandler(action, handler);
        registeredActions.push(action);
      } catch {
        // Some WebView versions expose Media Session but not every action.
      }
    };

    register("play", () => {
      if (isPaused) onTogglePause();
    });
    register("pause", () => {
      if (!isPaused) onTogglePause();
    });
    register("stop", () => {
      if (!isPaused) onTogglePause();
    });
    register("seekbackward", (details) =>
      onSeekRelative(-(details.seekOffset || 10)),
    );
    register("seekforward", (details) =>
      onSeekRelative(details.seekOffset || 10),
    );
    register("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        onSeek(Math.max(0, details.seekTime));
      }
    });
    if (onNext) register("nexttrack", onNext);
    if (onPrevious) register("previoustrack", onPrevious);

    return () => {
      registeredActions.forEach((action) => {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {}
      });
    };
  }, [enabled, isPaused, onNext, onPrevious, onSeek, onSeekRelative, onTogglePause]);

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (!mediaSession) return;

    mediaSession.playbackState = enabled
      ? isPaused
        ? "paused"
        : "playing"
      : "none";

    return () => {
      mediaSession.playbackState = "none";
    };
  }, [enabled, isPaused]);

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (
      !enabled ||
      !mediaSession ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return;
    }

    try {
      mediaSession.setPositionState({
        duration,
        playbackRate: Number.isFinite(playbackRate) && playbackRate > 0
          ? playbackRate
          : 1,
        position: Math.min(duration, Math.max(0, currentTime)),
      });
    } catch {
      // Ignore transient invalid position data while a new file is loading.
    }
  }, [currentTime, duration, enabled, playbackRate]);
};

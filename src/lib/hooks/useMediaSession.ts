import { useEffect } from "react";

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

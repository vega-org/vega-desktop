import { invoke } from "@tauri-apps/api/core";
import Hls from "hls.js";
import type {
  PlayerEngine,
  PlayerEngineOptions,
  PlayerEngineState,
  TrackInfo,
  ChapterInfo,
} from "./PlayerEngine";
import { JassubManager } from "./jassubManager";
import {
  isTorrentUrl,
  resolveTorrentStream,
  deleteTorrentStream,
  getInfoHashFromStreamUrl,
} from "../services/torrentStreamService";

interface ProbeStreamInfo {
  index: number;
  codec_type: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  fps?: number;
  bit_depth?: number;
  channels?: number;
  channel_layout?: string;
  language?: string;
  title?: string;
  is_default: boolean;
  is_bitmap_sub: boolean;
}

interface ProbeChapterInfo {
  id: number;
  title: string;
  start_time: number;
  end_time: number;
}

interface MediaProbeResult {
  format_name?: string;
  duration: number;
  video_tracks: ProbeStreamInfo[];
  audio_tracks: ProbeStreamInfo[];
  subtitle_tracks: ProbeStreamInfo[];
  chapters: ProbeChapterInfo[];
}

interface RemuxStreamInfo {
  session_id: string;
  generation: number;
  requested_start: number;
  source_reference_pts: number | null;
  output_reference_pts: number | null;
}

const WEB_FRIENDLY_AUDIO_CODECS = new Set([
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
]);

function mergeSrtContent(first: string, second: string): string {
  const seen = new Set<string>();
  const cues: string[] = [];
  for (const content of [first, second]) {
    for (const rawBlock of (content || "")
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)) {
      const lines = rawBlock
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) continue;
      const body = lines.slice(timingIndex).join("\n");
      if (!seen.has(body)) {
        seen.add(body);
        cues.push(body);
      }
    }
  }
  return cues.map((cue, index) => `${index + 1}\n${cue}`).join("\n\n");
}

function isVideoCodecSupported(codecName?: string): boolean {
  if (!codecName || typeof document === "undefined") return false;
  const name = codecName.toLowerCase();
  const video = document.createElement("video");

  const canPlay = (...mimeTypes: string[]) =>
    mimeTypes.some((mimeType) => video.canPlayType(mimeType) !== "");

  try {
    if (name.includes("h264") || name.includes("avc")) {
      return canPlay(
        'video/mp4; codecs="avc1.640028"',
        'video/mp4; codecs="avc1.42E01E"',
      );
    }
    if (name.includes("hevc") || name.includes("h265")) {
      // Apple WebKit requires the hvc1 sample-entry tag. The remuxer applies
      // that tag when copying HEVC into MP4.
      return canPlay(
        'video/mp4; codecs="hvc1"',
        'video/mp4; codecs="hvc1.1.6.L93.B0"',
      );
    }
    if (name.includes("av1") || name.includes("av01")) {
      return canPlay('video/mp4; codecs="av01.0.08M.08"');
    }
    if (name.includes("vp9")) {
      return canPlay('video/mp4; codecs="vp09.00.10.08"');
    }
  } catch {
    return false;
  }

  return false;
}

export class HtmlVideoEngine implements PlayerEngine {
  private video: HTMLVideoElement;
  private jassub: JassubManager | null = null;
  private hlsInstance: Hls | null = null;
  private listeners = new Set<(state: PlayerEngineState) => void>();

  private _state: PlayerEngineState = {
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
  };

  private currentSource: string = "";
  private currentHeaders: Record<string, string> = {};
  private proxyPort: number | null = null;
  private sessionId: string = "";
  private playbackMode: "direct" | "remux" | "transcode" = "direct";
  private selectedAudioIndex: number | null = null;
  private selectedSubtitleIndex: number | "off" = "off";
  private selectedVideoIndex: number = 0;
  private virtualTimeOffset: number = 0;
  private probedDuration: number = 0;
  private isDestroyed: boolean = false;
  private externalSubtitles: { url?: string; uri?: string; language?: string; title?: string }[] = [];
  private audioDelay: number = 0;
  private audioDelayDebounceTimer: any = null;
  private subtitleDelay: number = 0;
  private isSeeking: boolean = false;
  private seekSafetyTimer: any = null;
  private unlistenSubtitles: (() => void) | null = null;
  private unlistenStreamInfo: (() => void) | null = null;
  private requestedStartTime: number = 0;
  private subtitleRequestId: number = 0;
  private subtitleRenderQueue: Promise<void> = Promise.resolve();
  private subtitleContentMap: Map<number, string> = new Map();
  private subtitleWindowContentMap: Map<number, string> = new Map();
  private streamGeneration: number = 0;
  private sourceReferencePTS: number = 0;
  private outputReferencePTS: number = 0;
  private timelineOffset: number = 0;
  private targetMediaTime: number = 0;
  private usesRemuxClock: boolean = false;
  private timingGeneration: number = -1;
  private freezeCanvas: HTMLCanvasElement | null = null;
  private isPreparingRemuxPreroll: boolean = false;
  private loadRequestId: number = 0;
  private currentTorrentInfoHash: string | null = null;
  private hasTriedCodecFallback: boolean = false;

  private captureFreezeFrame(): void {
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;

    try {
      if (!this.freezeCanvas) {
        this.freezeCanvas = document.createElement("canvas");
        this.freezeCanvas.className = "player-freeze-frame";
        this.freezeCanvas.style.display = "none";
      }

      if (v.parentElement && !v.parentElement.contains(this.freezeCanvas)) {
        v.parentElement.insertBefore(this.freezeCanvas, v.nextSibling);
      }

      const canvas = this.freezeCanvas;
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      if (v.classList.contains("cropped")) {
        canvas.classList.add("cropped");
      } else {
        canvas.classList.remove("cropped");
      }
      canvas.style.transform = v.style.transform || "";
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.style.display = "block";
      }
    } catch (e) {
      console.warn("[HtmlVideoEngine] Failed to capture freeze frame:", e);
    }
  }

  private releaseFreezeFrame(): void {
    if (this.freezeCanvas && this.freezeCanvas.style.display !== "none") {
      requestAnimationFrame(() => {
        if (this.freezeCanvas) {
          this.freezeCanvas.style.display = "none";
        }
      });
    }
  }

  constructor(videoElement: HTMLVideoElement) {
    this.video = videoElement;
    this.jassub = new JassubManager(videoElement);
    this.attachVideoListeners();
    this.setupSubtitleListener();
    this.setupStreamInfoListener();
  }

  private async setupSubtitleListener(): Promise<void> {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<{
        source: string;
        track_index: number;
        subtitles: string;
        is_final: boolean;
      }>("subtitles_updated", async (event) => {
        console.warn("[SubDebug] subtitles_updated event:", {
          eventSource: event.payload.source?.substring(0, 80),
          eventTrackIndex: event.payload.track_index,
          isFinal: event.payload.is_final,
          contentLen: event.payload.subtitles?.length,
          selectedSubIdx: this.selectedSubtitleIndex,
          currentSourceMatch: event.payload.source === this.currentSource,
          hasJassub: !!this.jassub,
        });
        if (
          this.selectedSubtitleIndex !== "off" &&
          event.payload.source === this.currentSource &&
          event.payload.track_index === this.selectedSubtitleIndex &&
          this.jassub
        ) {
          const requestId = this.subtitleRequestId;
          const trackId = event.payload.track_index;
          const windowContent = this.subtitleWindowContentMap.get(
            trackId,
          );
          // The current-position window is already usable. Do not let an
          // incomplete background extraction from the beginning of the file
          // replace it. Apply again only when the complete track is ready.
          if (windowContent && !event.payload.is_final) {
            return;
          }
          const subtitleContent = windowContent
            ? mergeSrtContent(event.payload.subtitles, windowContent)
            : event.payload.subtitles;
          if (subtitleContent && subtitleContent.trim() && subtitleContent.includes("-->")) {
            console.warn("[SubDebug] Applying progressive subtitle update, length:", event.payload.subtitles.length);
            await this.queueSubtitleRender(trackId, requestId, subtitleContent);
          }
          if (
            event.payload.is_final &&
            this.subtitleRequestId === requestId &&
            this.selectedSubtitleIndex === trackId
          ) {
            this.subtitleWindowContentMap.delete(trackId);
          }
        }
      });
      if (this.isDestroyed) {
        unlisten();
      } else {
        this.unlistenSubtitles = unlisten;
      }
    } catch (err) {
      console.warn("[HtmlVideoEngine] Failed to setup subtitles_updated listener:", err);
    }
  }

  private async setupStreamInfoListener(): Promise<void> {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<RemuxStreamInfo>("remux_stream_info", (event) => {
        if (event.payload && event.payload.session_id === this.sessionId) {
          this.applyStreamInfo(event.payload);
        }
      });
      if (this.isDestroyed) {
        unlisten();
      } else {
        this.unlistenStreamInfo = unlisten;
      }
    } catch (err) {
      console.warn("[HtmlVideoEngine] Failed to setup remux_stream_info listener:", err);
    }
  }

  private applyStreamInfo(info: RemuxStreamInfo): boolean {
    const { session_id, generation, requested_start, source_reference_pts, output_reference_pts } = info;
    if (session_id && session_id !== this.sessionId) return false;
    if (generation !== undefined && generation !== this.streamGeneration) {
      console.log(
        `[HtmlVideoEngine] Discarding stale stream info: gen=${generation}, currentGen=${this.streamGeneration}`,
      );
      return false;
    }
    if (Math.abs(requested_start - this.requestedStartTime) > 0.5) return false;
    if (
      source_reference_pts === null ||
      output_reference_pts === null ||
      !Number.isFinite(source_reference_pts) ||
      !Number.isFinite(output_reference_pts)
    ) {
      return false;
    }

    this.sourceReferencePTS = source_reference_pts;
    this.outputReferencePTS = output_reference_pts;
    this.timelineOffset = source_reference_pts - output_reference_pts;
    this.targetMediaTime = output_reference_pts + (requested_start - source_reference_pts);
    this.virtualTimeOffset = this.timelineOffset;
    this.timingGeneration = generation;
    this.updateJassubTimeOffset();

    console.log(
      `[HtmlVideoEngine] Stream timing aligned (gen ${generation}): req=${requested_start.toFixed(3)}s, srcPTS=${source_reference_pts.toFixed(3)}s, outPTS=${output_reference_pts.toFixed(3)}s, offset=${this.timelineOffset.toFixed(3)}s, targetMediaTime=${this.targetMediaTime.toFixed(3)}s`,
    );
    return true;
  }

  public get state(): PlayerEngineState {
    return this._state;
  }

  public get source(): string {
    return this.currentSource;
  }

  public get headers(): Record<string, string> {
    return this.currentHeaders;
  }

  public get selectedSubtitle(): number | "off" {
    return this.selectedSubtitleIndex;
  }

  public get streamTiming(): {
    sourceReferencePTS: number;
    outputReferencePTS: number;
    timelineOffset: number;
    targetMediaTime: number;
  } {
    return {
      sourceReferencePTS: this.sourceReferencePTS,
      outputReferencePTS: this.outputReferencePTS,
      timelineOffset: this.timelineOffset,
      targetMediaTime: this.targetMediaTime,
    };
  }

  public subscribe(listener: (state: PlayerEngineState) => void): () => void {
    this.listeners.add(listener);
    listener(this._state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitState(): void {
    if (this.isDestroyed) return;
    for (const listener of this.listeners) {
      listener(this._state);
    }
  }

  private updateState(partial: Partial<PlayerEngineState>): void {
    this._state = { ...this._state, ...partial };
    this.emitState();
  }

  private updateJassubTimeOffset(): void {
    if (this.jassub) {
      const baseOffset = this.usesRemuxClock ? this.timelineOffset : 0;
      const delayOffset = -(this.subtitleDelay / 1000);
      this.jassub.setTimeOffset(baseOffset + delayOffset);
    }
  }

  private queueSubtitleRender(
    trackId: number | "off",
    requestId: number,
    content: string | null,
  ): Promise<void> {
    const render = async () => {
      if (
        this.isDestroyed ||
        !this.jassub ||
        this.subtitleRequestId !== requestId ||
        this.selectedSubtitleIndex !== trackId
      ) {
        return;
      }

      this.updateJassubTimeOffset();
      if (
        content &&
        content.trim() &&
        (content.includes("-->") ||
          content.includes("[Script Info]") ||
          content.includes("Dialogue:"))
      ) {
        await this.jassub.setTrackContent(content);
      } else {
        await this.jassub.clearTrack();
      }
    };

    const queued = this.subtitleRenderQueue.then(render, render);
    this.subtitleRenderQueue = queued.catch((error) => {
      console.warn("[HtmlVideoEngine] Subtitle renderer update failed:", error);
    });
    return queued;
  }

  private async refreshEmbeddedSubtitleWindow(
    sourceTime: number,
    streamGeneration: number,
  ): Promise<void> {
    const trackId = this.selectedSubtitleIndex;
    if (typeof trackId !== "number" || trackId >= 10000) return;
    const requestId = this.subtitleRequestId;

    try {
      const windowText = await invoke<string>("extract_subtitle_window", {
        source: this.currentSource,
        trackIndex: trackId,
        startTime: sourceTime,
        headers: this.currentHeaders,
      });
      if (
        this.isDestroyed ||
        this.streamGeneration !== streamGeneration ||
        this.subtitleRequestId !== requestId ||
        this.selectedSubtitleIndex !== trackId ||
        !windowText ||
        !windowText.includes("-->")
      ) {
        return;
      }

      this.subtitleWindowContentMap.set(trackId, windowText);
      const existing = this.subtitleContentMap.get(trackId) || "";
      const displayText = mergeSrtContent(existing, windowText);
      this.subtitleContentMap.set(trackId, displayText);
      await this.queueSubtitleRender(trackId, requestId, displayText);
    } catch (error) {
      console.warn(
        "[HtmlVideoEngine] Failed to refresh subtitles after seek:",
        error,
      );
    }
  }

  private attachVideoListeners(): void {
    const v = this.video;

    v.addEventListener("play", () => {
      this.updateState({ isPaused: false });
    });

    v.addEventListener("pause", () => {
      this.updateState({
        isPaused: true,
        isBuffering: this.isSeeking || this.isPreparingRemuxPreroll,
      });
      if (this.jassub) {
        this.jassub.renderFrame(v.currentTime);
      }
    });

    const finishSeeking = () => {
      if (this.seekSafetyTimer) {
        clearTimeout(this.seekSafetyTimer);
        this.seekSafetyTimer = null;
      }
      this.isSeeking = false;
    };

    v.addEventListener("timeupdate", () => {
      if (this.isSeeking) {
        return;
      }
      const actualTime =
        this.usesRemuxClock ? this.timelineOffset + v.currentTime : v.currentTime;
      this.updateState({
        currentTime: actualTime,
        duration: this.probedDuration || v.duration || 0,
      });
      if (v.paused && this.jassub) {
        this.jassub.renderFrame(v.currentTime);
      }
    });

    v.addEventListener("durationchange", () => {
      if (!this.probedDuration && v.duration) {
        this.updateState({ duration: v.duration });
      }
    });

    v.addEventListener("waiting", () => {
      this.updateState({ isBuffering: true });
      if (this.jassub) {
        this.jassub.setBuffering(true);
      }
    });

    v.addEventListener("playing", () => {
      if (this.isPreparingRemuxPreroll) {
        this.updateState({ isBuffering: true, isPaused: false });
        if (this.jassub) this.jassub.setBuffering(true);
        return;
      }
      this.releaseFreezeFrame();
      finishSeeking();
      this.updateState({ isBuffering: false, isPaused: false });
      if (this.jassub) {
        this.jassub.setBuffering(false);
        this.jassub.resize();
      }
    });

    v.addEventListener("canplay", () => {
      if (this.isPreparingRemuxPreroll) return;
      this.releaseFreezeFrame();
      if (v.paused) {
        finishSeeking();
        this.updateState({ isBuffering: false });
      }
      if (this.jassub) {
        this.jassub.setBuffering(false);
        this.jassub.resize();
      }
    });

    v.addEventListener("canplaythrough", () => {
      if (this.isPreparingRemuxPreroll) return;
      if (v.paused) {
        this.updateState({ isBuffering: false });
      }
      if (this.jassub) {
        this.jassub.setBuffering(false);
      }
    });

    v.addEventListener("loadeddata", () => {
      if (this.isPreparingRemuxPreroll) return;
      this.releaseFreezeFrame();
      this.updateState({ isBuffering: false });
      if (this.jassub) {
        this.jassub.resize();
      }
    });

    v.addEventListener("seeking", () => {
      this.updateState({ isBuffering: true });
    });

    v.addEventListener("seeked", () => {
      finishSeeking();
      this.updateState({ isBuffering: false });
      if (this.jassub) {
        this.updateJassubTimeOffset();
        this.jassub.renderFrame(v.currentTime);
      }
    });

    v.addEventListener("progress", () => {
      if (v.buffered.length > 0) {
        const bufferedEnd = v.buffered.end(v.buffered.length - 1);
        const cacheDur = Math.max(0, bufferedEnd - v.currentTime);
        this.updateState({ cacheDuration: cacheDur });
      }
    });

    v.addEventListener("volumechange", () => {
      this.updateState({ volume: Math.round(v.volume * 100) });
    });

    v.addEventListener("ratechange", () => {
      this.updateState({ speed: v.playbackRate });
    });

    v.addEventListener("loadedmetadata", () => {
      this.updateState({
        videoHeight: v.videoHeight,
        duration: this.probedDuration || v.duration || 0,
      });
      if (this.jassub) {
        this.jassub.resize();
      }

      const nativeAudio = (v as any).audioTracks;
      if (nativeAudio && nativeAudio.length > 0) {
        const audioTracks: TrackInfo[] = [];
        for (let i = 0; i < nativeAudio.length; i++) {
          const t = nativeAudio[i];
          audioTracks.push({
            id: i,
            type: "audio",
            title: t.label || `Audio ${i + 1}`,
            lang: t.language || "",
            codec: "auto",
            selected: t.enabled ?? (i === 0),
            external: false,
          });
        }
        this.updateState({
          audioTracks,
          tracks: [...this.state.tracks.filter((t) => t.type !== "audio"), ...audioTracks],
        });
      } else if (this.state.audioTracks.length === 0) {
        const defaultAudio: TrackInfo = {
          id: 0,
          type: "audio",
          title: "Default Audio",
          lang: "und",
          codec: "auto",
          selected: true,
          external: false,
        };
        this.updateState({
          audioTracks: [defaultAudio],
          tracks: [...this.state.tracks.filter((t) => t.type !== "audio"), defaultAudio],
        });
      }

      if (this.state.videoTracks.length === 0 && v.videoHeight > 0) {
        const defaultVideo: TrackInfo = {
          id: 0,
          type: "video",
          title: `${v.videoWidth || 0}x${v.videoHeight || 0}`,
          lang: "",
          codec: "auto",
          selected: true,
          external: false,
          demuxW: v.videoWidth,
          demuxH: v.videoHeight,
        };
        this.updateState({
          videoTracks: [defaultVideo],
          tracks: [...this.state.tracks.filter((t) => t.type !== "video"), defaultVideo],
        });
      }
    });

    v.addEventListener("error", () => {
      this.releaseFreezeFrame();
      const err = v.error;
      const msg = err ? `Video error code ${err.code}: ${err.message}` : "Playback error";
      console.warn("[HtmlVideoEngine] Video element error:", msg);

      // canPlayType() is only a capability hint. Some WebKit/GStreamer builds
      // claim a codec but reject the actual profile once bytes arrive. Retry
      // once through FFmpeg instead of leaving macOS/Linux on error code 4.
      if (
        err?.code === 4 && // MEDIA_ERR_SRC_NOT_SUPPORTED
        this.playbackMode === "remux" &&
        !this.hasTriedCodecFallback &&
        !this.isDestroyed
      ) {
        this.hasTriedCodecFallback = true;
        this.playbackMode = "transcode";
        const resumeAfterPrepare = !this.state.isPaused;
        const restartTime = Math.max(
          0,
          Number.isFinite(this.state.currentTime)
            ? this.state.currentTime
            : this.requestedStartTime,
        );
        this.updateState({ error: null, isBuffering: true });
        void this.startStream(restartTime, resumeAfterPrepare)
          .then(() => resumeAfterPrepare ? this.play() : undefined)
          .catch((fallbackError) => {
            const fallbackMessage = fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError);
            console.warn("[HtmlVideoEngine] Codec fallback failed:", fallbackError);
            this.updateState({ error: fallbackMessage, isBuffering: false });
          });
        return;
      }
      this.updateState({ error: msg, isBuffering: false });
    });
  }

  private async getProxyPort(): Promise<number> {
    if (this.proxyPort) return this.proxyPort;
    const port = await invoke<number>("get_stream_proxy_port");
    this.proxyPort = port;
    return port;
  }

  public async load(source: string, options?: PlayerEngineOptions): Promise<void> {
    const currentLoadId = ++this.loadRequestId;
    this.hasTriedCodecFallback = false;

    if (this.currentTorrentInfoHash) {
      const prevHash = this.currentTorrentInfoHash;
      this.currentTorrentInfoHash = null;
      deleteTorrentStream(prevHash).catch((err) => {
        console.warn("[HtmlVideoEngine] Failed to delete previous torrent stream:", err);
      });
    }

    if (isTorrentUrl(source)) {
      this.updateState({
        isInitialized: true,
        isBuffering: true,
        error: null,
        currentTime: options?.startTime || 0,
        duration: 0,
      });

      try {
        const resolved = await resolveTorrentStream(source);
        if (this.loadRequestId !== currentLoadId || this.isDestroyed) {
          deleteTorrentStream(resolved.infoHash).catch(() => {});
          return;
        }
        this.currentTorrentInfoHash = resolved.infoHash;
        source = resolved.streamUrl;
      } catch (err: any) {
        if (this.loadRequestId !== currentLoadId || this.isDestroyed) return;
        console.error("[HtmlVideoEngine] Failed to resolve torrent stream:", err);
        const msg = err?.message || "Failed to resolve torrent stream";
        this.updateState({ error: msg, isBuffering: false, isPaused: true });
        throw err;
      }
    } else {
      const existingHash = getInfoHashFromStreamUrl(source);
      if (existingHash) {
        this.currentTorrentInfoHash = existingHash;
      }
    }

    this.currentSource = source;
    this.currentHeaders = options?.headers || {};
    this.externalSubtitles = options?.subtitles || [];
    this.virtualTimeOffset = options?.startTime || 0;
    this.audioDelay = 0;
    this.subtitleDelay = 0;
    if (this.audioDelayDebounceTimer) {
      clearTimeout(this.audioDelayDebounceTimer);
      this.audioDelayDebounceTimer = null;
    }
    this.sessionId = `session-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }

    this.selectedAudioIndex = null;
    const subtitleLoadRequestId = ++this.subtitleRequestId;
    this.selectedSubtitleIndex = "off";
    this.subtitleContentMap.clear();
    this.subtitleWindowContentMap.clear();
    await this.queueSubtitleRender("off", subtitleLoadRequestId, null);

    this.updateState({
      isInitialized: true,
      isBuffering: true,
      error: null,
      currentTime: this.virtualTimeOffset,
      duration: 0,
      audioDelay: 0,
      subtitleDelay: 0,
    });

    const isHls =
      source.includes(".m3u8") ||
      source.includes("m3u8") ||
      (this.currentHeaders["content-type"] || "").includes("mpegurl");

    if (isHls && Hls.isSupported()) {
      await this.startHlsStream(source, options);
      return;
    }

    try {
      const probeResult = await invoke<MediaProbeResult>("probe_media_info", {
        source,
        headers: this.currentHeaders,
      }).catch((e) => {
        console.warn("[HtmlVideoEngine] Probing failed, falling back to direct play:", e);
        return null;
      });

      let audioTracks: TrackInfo[] = [];
      let subtitleTracks: TrackInfo[] = [];
      let videoTracks: TrackInfo[] = [];
      let chapters: ChapterInfo[] = [];

      if (probeResult) {
        this.probedDuration = probeResult.duration || 0;
        this.updateState({ duration: this.probedDuration });

        videoTracks = probeResult.video_tracks.map((vt) => ({
          id: vt.index,
          type: "video",
          title: vt.title || `${vt.width || 0}x${vt.height || 0}`,
          lang: vt.language || "",
          codec: vt.codec_name || "",
          selected: vt.index === 0,
          external: false,
          demuxW: vt.width,
          demuxH: vt.height,
        }));

        const primaryVideo = probeResult.video_tracks[0];
        if (primaryVideo?.width && primaryVideo?.height && this.jassub) {
          this.jassub.setVideoDimensions(primaryVideo.width, primaryVideo.height);
        }

        audioTracks = probeResult.audio_tracks.map((at, idx) => ({
          id: at.index,
          type: "audio",
          title: at.title || `Audio ${idx + 1}`,
          lang: at.language || "",
          codec: at.codec_name || "",
          selected: at.is_default || idx === 0,
          external: false,
        }));

        subtitleTracks = probeResult.subtitle_tracks.map((st, idx) => ({
          id: st.index,
          type: "sub",
          title: st.title || `Subtitle ${idx + 1}`,
          lang: st.language || "",
          codec: st.codec_name || "",
          selected: false,
          external: false,
          isBitmapSub: st.is_bitmap_sub,
          is_default: st.is_default,
        }));

        if (this.externalSubtitles.length > 0) {
          const externalSubs: TrackInfo[] = this.externalSubtitles.map((sub, idx) => ({
            id: 10000 + idx,
            type: "sub",
            title: sub.title || sub.language || `Subtitle ${idx + 1}`,
            lang: sub.language || "",
            codec: "srt",
            selected: false,
            external: true,
          }));
          subtitleTracks = [...subtitleTracks, ...externalSubs];
        }

        chapters = probeResult.chapters.map((c) => ({
          title: c.title,
          time: c.start_time,
        }));

        const isLocal =
          !source.startsWith("http://") &&
          !source.startsWith("https://") &&
          !source.startsWith("asset://") &&
          !source.startsWith("blob:") &&
          !source.startsWith("magnet:");

        if (audioTracks.length === 0) {
          audioTracks = [
            {
              id: 0,
              type: "audio",
              title: "Default Audio",
              lang: "und",
              codec: "auto",
              selected: true,
              external: false,
            },
          ];
        }
        if (videoTracks.length === 0) {
          videoTracks = [
            {
              id: 0,
              type: "video",
              title: "Default Video",
              lang: "",
              codec: "auto",
              selected: true,
              external: false,
            },
          ];
        }

        const defaultAudio = audioTracks.find((t) => t.selected) || audioTracks[0];
        if (defaultAudio) {
          this.selectedAudioIndex = defaultAudio.id;
        }

        const videoSupported = isVideoCodecSupported(primaryVideo?.codec_name);
        const audioSupported = defaultAudio
          ? WEB_FRIENDLY_AUDIO_CODECS.has(defaultAudio.codec.toLowerCase())
          : true;
        const formatName = (probeResult.format_name || "").toLowerCase();
        const isMatroska =
          formatName.includes("matroska") ||
          source.toLowerCase().includes(".mkv") ||
          (this.currentHeaders["content-disposition"] || "").toLowerCase().includes(".mkv");

        const hasMultipleAudio = audioTracks.length > 1;

        const isDirectWebContainer =
          !isMatroska &&
          (formatName === "mp4" ||
            (formatName.includes("mp4") && !formatName.includes("matroska")) ||
            (formatName === "webm" && !formatName.includes("matroska")));

        const canDirectPlay =
          (isLocal && !isMatroska && videoSupported && audioSupported) ||
          (!isMatroska &&
            !hasMultipleAudio &&
            isDirectWebContainer &&
            videoSupported &&
            audioSupported);

        if (canDirectPlay) {
          this.playbackMode = "direct";
        } else if (videoSupported) {
          this.playbackMode = "remux";
        } else {
          this.playbackMode = "transcode";
        }
      } else {
        const isMkv =
          source.toLowerCase().includes(".mkv") ||
          source.toLowerCase().includes("mkv") ||
          (this.currentHeaders["content-disposition"] || "").includes(".mkv");

        this.playbackMode = isMkv ? "remux" : "direct";

        videoTracks = [
          {
            id: 0,
            type: "video",
            title: "Default Video",
            lang: "",
            codec: isMkv ? "h264" : "auto",
            selected: true,
            external: false,
          },
        ];
        audioTracks = [
          {
            id: 0,
            type: "audio",
            title: "Default Audio",
            lang: "und",
            codec: isMkv ? "aac" : "auto",
            selected: true,
            external: false,
          },
        ];
        this.selectedAudioIndex = 0;

        if (this.externalSubtitles.length > 0) {
          subtitleTracks = this.externalSubtitles.map((sub, idx) => ({
            id: 10000 + idx,
            type: "sub",
            title: sub.title || sub.language || `Subtitle ${idx + 1}`,
            lang: sub.language || "",
            codec: "srt",
            selected: false,
            external: true,
          }));
        }
      }

      this.updateState({
        tracks: [...videoTracks, ...audioTracks, ...subtitleTracks],
        videoTracks,
        audioTracks,
        subtitleTracks,
        chapters,
        isInitialized: true,
      });

      await this.startStream(
        this.virtualTimeOffset,
        options?.autoPlay !== false,
      );

      if (options?.autoPlay !== false) {
        await this.play().catch((e) => {
          console.warn("[HtmlVideoEngine] Autoplay prevented or delayed:", e);
          this.updateState({ isPaused: true, isBuffering: false });
        });
      }
    } catch (err: any) {
      console.warn("[HtmlVideoEngine] Playback setup error:", err);
      if (
        this.hasTriedCodecFallback &&
        this.playbackMode === "transcode" &&
        String(err?.message || err).toLowerCase().includes("superseded")
      ) {
        // Error-code fallback intentionally replaced the rejected remux. Its
        // own startStream call now owns playback preparation.
        return;
      }
      if (this.usesRemuxClock) {
        const message = err?.message || "Failed to prepare remux stream";
        this.updateState({ error: message, isBuffering: false, isPaused: true });
        throw err;
      }
      this.video.src = source;
      this.video.load();
      if (options?.autoPlay !== false) {
        await this.play().catch(() => {
          this.updateState({ isPaused: true, isBuffering: false });
        });
      }
    }
  }

  private async startHlsStream(source: string, options?: PlayerEngineOptions): Promise<void> {
    const port = await this.getProxyPort();
    const hasHeaders = Object.keys(this.currentHeaders).length > 0;

    let hlsUrl = source;
    if (hasHeaders) {
      const params = new URLSearchParams();
      params.set("url", source);
      const referer = this.currentHeaders.Referer || this.currentHeaders.referer;
      const ua = this.currentHeaders["User-Agent"] || this.currentHeaders["user-agent"];
      let origin = this.currentHeaders.Origin || this.currentHeaders.origin;
      if (!origin && referer) {
        try {
          origin = new URL(referer).origin;
        } catch {}
      }
      if (referer) params.set("referer", referer);
      if (ua) params.set("ua", ua);
      if (origin) params.set("origin", origin);
      params.set("headers", JSON.stringify(this.currentHeaders));
      hlsUrl = `http://127.0.0.1:${port}/playlist.m3u8?${params.toString()}`;
    }

    const hls = new Hls({
      startPosition: this.virtualTimeOffset > 0 ? this.virtualTimeOffset : -1,
      enableWorker: true,
    });
    this.hlsInstance = hls;

    hls.loadSource(hlsUrl);
    hls.attachMedia(this.video);

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      this.updateState({
        isInitialized: true,
        isBuffering: false,
        duration: this.video.duration || 0,
      });

      let audioTracks: TrackInfo[] = (data.audioTracks || []).map((at, idx) => ({
        id: idx,
        type: "audio",
        title: at.name || `Audio ${idx + 1}`,
        lang: at.lang || "",
        codec: "aac",
        selected: idx === 0,
        external: false,
      }));

      if (audioTracks.length === 0) {
        audioTracks = [
          {
            id: 0,
            type: "audio",
            title: "Default Audio",
            lang: "und",
            codec: "auto",
            selected: true,
            external: false,
          },
        ];
      }

      let videoTracks: TrackInfo[] = [];
      if (data.levels && data.levels.length > 0) {
        videoTracks = data.levels.map((level, idx) => {
          const height = level.height || 0;
          const width = level.width || 0;
          const label = height > 0 ? `${height}p` : `Level ${idx + 1}`;
          return {
            id: idx,
            type: "video",
            title: label,
            lang: "",
            codec: (level.attrs as any)?.CODECS || "auto",
            selected: hls.currentLevel === idx,
            external: false,
            demuxW: width,
            demuxH: height,
            bitrate: level.bitrate,
          };
        });
      }

      if (videoTracks.length === 0) {
        videoTracks = [
          {
            id: 0,
            type: "video",
            title: "Default Video",
            lang: "",
            codec: "auto",
            selected: true,
            external: false,
          },
        ];
      }

      const hlsSubTracks: TrackInfo[] = (data.subtitleTracks || []).map((st, idx) => ({
        id: idx,
        type: "sub",
        title: st.name || `Subtitle ${idx + 1}`,
        lang: st.lang || "",
        codec: "vtt",
        selected: false,
        external: false,
      }));

      const externalSubs: TrackInfo[] = this.externalSubtitles.map((sub, idx) => ({
        id: 10000 + idx,
        type: "sub",
        title: sub.title || sub.language || `Subtitle ${idx + 1}`,
        lang: sub.language || "",
        codec: "srt",
        selected: false,
        external: true,
      }));

      const subtitleTracks = [...hlsSubTracks, ...externalSubs];

      this.selectedAudioIndex = audioTracks[0]?.id ?? 0;

      this.updateState({
        tracks: [...videoTracks, ...audioTracks, ...subtitleTracks],
        videoTracks,
        audioTracks,
        subtitleTracks,
      });

      if (options?.autoPlay !== false) {
        this.play().catch(() => { });
      }
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const activeLvl = hls.levels?.[data.level];
      if (activeLvl?.height) {
        this.updateState({
          videoHeight: activeLvl.height,
        });
      }
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        console.warn("[HtmlVideoEngine] HLS fatal error, trying direct HTML5 video:", data);
        hls.destroy();
        this.hlsInstance = null;
        this.video.src = source;
        this.video.load();
        this.play().catch(() => { });
      }
    });
  }

  private async waitForVerifiedStreamTiming(
    port: number,
    sessionId: string,
    generation: number,
  ): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (!this.isDestroyed && this.streamGeneration === generation && Date.now() < deadline) {
      if (this.timingGeneration === generation) return;
      try {
        const response = await fetch(
          `http://127.0.0.1:${port}/remux/info?session_id=${encodeURIComponent(sessionId)}&generation=${generation}`,
          { cache: "no-store" },
        );
        if (response.status === 204) {
          // FFmpeg has not published the first output timestamp yet.
        } else if (response.ok) {
          const info = (await response.json()) as RemuxStreamInfo;
          if (this.applyStreamInfo(info)) return;
        }
      } catch {
        // The stream request may not have reached the server yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    if (this.streamGeneration !== generation || this.isDestroyed) {
      throw new Error("Stream restart was superseded");
    }
    throw new Error("FFmpeg did not provide verified seek timing");
  }

  private async finishRemuxPreroll(
    generation: number,
    resumeAfterPrepare: boolean,
  ): Promise<void> {
    const target = Math.max(0, this.targetMediaTime);
    const originalMuted = this.video.muted;
    this.isPreparingRemuxPreroll = true;
    this.video.muted = true;
    this.updateState({ isBuffering: true });
    if (this.jassub) this.jassub.setBuffering(true);

    try {
      await this.video.play();
      const deadline = Date.now() + 30_000;
      while (
        !this.isDestroyed &&
        this.streamGeneration === generation &&
        this.video.currentTime + 0.04 < target &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      if (this.isDestroyed || this.streamGeneration !== generation) {
        throw new Error("Remux preroll was superseded");
      }
      if (this.video.currentTime + 0.2 < target) {
        throw new Error(
          `Remux preroll did not reach ${target.toFixed(3)}s`,
        );
      }

      if (!resumeAfterPrepare) this.video.pause();
    } finally {
      this.video.muted = originalMuted;
      this.isPreparingRemuxPreroll = false;
    }

    this.releaseFreezeFrame();
    this.updateState({
      currentTime: this.requestedStartTime,
      isBuffering: false,
      isPaused: !resumeAfterPrepare,
    });
    if (this.jassub) {
      this.jassub.setBuffering(false);
      this.updateJassubTimeOffset();
      this.jassub.renderFrame(this.video.currentTime);
    }
  }

  private async startStream(
    startTime: number,
    resumeAfterPrepare = false,
  ): Promise<void> {
    this.streamGeneration++;
    const gen = this.streamGeneration;
    const oldSessionId = this.sessionId;
    this.sessionId = `stream-${Date.now()}-${gen}-${Math.floor(Math.random() * 10000)}`;
    const streamSessionId = this.sessionId;
    this.requestedStartTime = startTime;
    this.sourceReferencePTS = Number.NaN;
    this.outputReferencePTS = Number.NaN;
    this.timelineOffset = startTime;
    this.targetMediaTime = 0;
    this.timingGeneration = -1;
    this.updateJassubTimeOffset();

    const port = await this.getProxyPort();
    if (oldSessionId) {
      fetch(`http://127.0.0.1:${port}/remux/cancel?session_id=${encodeURIComponent(oldSessionId)}`).catch(() => {});
    }

    const isLocal =
      !this.currentSource.startsWith("http://") &&
      !this.currentSource.startsWith("https://") &&
      !this.currentSource.startsWith("asset://") &&
      !this.currentSource.startsWith("blob:") &&
      !this.currentSource.startsWith("magnet:");

    const hasHeaders = Object.keys(this.currentHeaders).length > 0;

    if (this.playbackMode === "direct" && this.audioDelay === 0) {
      if (isLocal) {
        this.usesRemuxClock = false;
        this.captureFreezeFrame();
        this.video.src = `http://127.0.0.1:${port}/file?path=${encodeURIComponent(this.currentSource)}`;
        if (startTime > 0) {
          this.video.currentTime = startTime;
        }
        this.video.load();
        return;
      } else if (!hasHeaders) {
        this.usesRemuxClock = false;
        this.captureFreezeFrame();
        this.video.src = this.currentSource;
        if (startTime > 0) {
          this.video.currentTime = startTime;
        }
        this.video.load();
        return;
      }
      // If direct mode has custom headers, route through remux proxy which injects headers!
    }

    this.usesRemuxClock = true;

    const params = new URLSearchParams();
    params.set("url", this.currentSource);
    params.set("mode", this.playbackMode === "direct" ? "remux" : this.playbackMode);
    params.set("session_id", streamSessionId);
    params.set("generation", String(this.streamGeneration));

    if (startTime > 0) {
      params.set("start", startTime.toFixed(3));
    }

    if (this.audioDelay !== 0) {
      params.set("audio_delay", String(this.audioDelay));
    }

    if (this.selectedAudioIndex !== null) {
      params.set("audio_index", String(this.selectedAudioIndex));
    }

    const selectedAudio = this.state.audioTracks.find(
      (t) => t.id === this.selectedAudioIndex,
    );
    if (selectedAudio?.codec) {
      params.set("audio_codec", selectedAudio.codec);
    }

    const selectedVideo = this.state.videoTracks.find(
      (t) => t.id === this.selectedVideoIndex,
    ) || this.state.videoTracks[0];
    if (selectedVideo?.codec) {
      params.set("video_codec", selectedVideo.codec);
    }

    if (this.selectedVideoIndex !== null) {
      params.set("video_index", String(this.selectedVideoIndex));
    }

    const referer = this.currentHeaders.Referer || this.currentHeaders.referer;
    const ua = this.currentHeaders["User-Agent"] || this.currentHeaders["user-agent"];
    let origin = this.currentHeaders.Origin || this.currentHeaders.origin;
    if (!origin && referer) {
      try {
        origin = new URL(referer).origin;
      } catch {}
    }

    if (referer) {
      params.set("referer", referer);
    }
    if (ua) {
      params.set("ua", ua);
    }
    if (origin) {
      params.set("origin", origin);
    }
    params.set("headers", JSON.stringify(this.currentHeaders));

    this.isPreparingRemuxPreroll = startTime > 0.05;
    this.captureFreezeFrame();
    const streamUrl = `http://127.0.0.1:${port}/remux?${params.toString()}`;
    this.video.src = streamUrl;
    this.video.preload = "auto";
    this.video.load();
    // WebKit on macOS may defer a media request despite preload="auto". Start
    // it muted so FFmpeg and its timing metadata are guaranteed to begin.
    const originalMuted = this.video.muted;
    if (!resumeAfterPrepare) this.video.muted = true;
    void this.video.play().catch((error) => {
      console.debug("[HtmlVideoEngine] Initial media request is pending:", error);
    });
    try {
      await this.waitForVerifiedStreamTiming(port, streamSessionId, gen);
      this.video.muted = originalMuted;
      void this.refreshEmbeddedSubtitleWindow(this.requestedStartTime, gen);
      if (this.isPreparingRemuxPreroll && this.targetMediaTime > 0.05) {
        await this.finishRemuxPreroll(gen, resumeAfterPrepare);
      } else {
        this.isPreparingRemuxPreroll = false;
        if (!resumeAfterPrepare) this.video.pause();
        this.releaseFreezeFrame();
      }
    } catch (error) {
      this.video.muted = originalMuted;
      this.isPreparingRemuxPreroll = false;
      this.releaseFreezeFrame();
      throw error;
    }
  }

  public async play(): Promise<void> {
    this.updateState({ isPaused: false });
    try {
      await this.video.play();
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.warn("[HtmlVideoEngine] video.play() rejected:", err);
        this.updateState({ isPaused: true, isBuffering: false });
      }
    }
  }

  public pause(): void {
    this.video.pause();
    this.updateState({ isPaused: true, isBuffering: false });
  }

  public async seek(time: number): Promise<void> {
    const clamped = Math.max(0, Math.min(time, this.state.duration || time));

    this.isSeeking = true;
    if (this.seekSafetyTimer) {
      clearTimeout(this.seekSafetyTimer);
    }
    this.seekSafetyTimer = setTimeout(() => {
      this.isSeeking = false;
      this.seekSafetyTimer = null;
      this.updateState({ isBuffering: false });
    }, this.usesRemuxClock ? 8000 : 1500);

    if (this.hlsInstance || (this.playbackMode === "direct" && !this.usesRemuxClock)) {
      this.video.currentTime = clamped;
      this.updateState({ currentTime: clamped, isBuffering: true });
      return;
    }

    const wasPlaying = !this.video.paused && !this.state.isPaused;
    this.updateState({ currentTime: clamped, isBuffering: true });

    try {
      await this.startStream(clamped, wasPlaying);
    } catch (e) {
      console.error("[HtmlVideoEngine] Seek startStream error:", e);
    }

    if (this.seekSafetyTimer) {
      clearTimeout(this.seekSafetyTimer);
      this.seekSafetyTimer = null;
    }
    this.isSeeking = false;

    if (wasPlaying) {
      await this.play().catch(() => { });
    } else {
      this.updateState({ isBuffering: false, isPaused: true, currentTime: clamped });
    }
  }

  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(volume, 100));
    this.video.volume = clamped / 100;
  }

  public setSpeed(speed: number): void {
    this.video.playbackRate = speed;
  }

  public async selectTrack(
    type: "aid" | "sid" | "vid",
    id: number | "no" | "auto",
  ): Promise<void> {
    if (type === "aid") {
      if (typeof id === "number") {
        if (
          this.selectedAudioIndex === id &&
          this.state.audioTracks.some((t) => t.id === id && t.selected)
        ) {
          return;
        }

        if (this.hlsInstance) {
          this.hlsInstance.audioTrack = id;
          this.selectedAudioIndex = id;
          const updated = this.state.audioTracks.map((t) => ({
            ...t,
            selected: t.id === id,
          }));
          this.updateState({ audioTracks: updated });
          return;
        }

        const vAudioTracks = (this.video as any).audioTracks;
        if (vAudioTracks && vAudioTracks.length > 0 && id < vAudioTracks.length) {
          for (let i = 0; i < vAudioTracks.length; i++) {
            vAudioTracks[i].enabled = i === id;
          }
        }

        this.selectedAudioIndex = id;
        const updated = this.state.audioTracks.map((t) => ({
          ...t,
          selected: t.id === id,
        }));
        this.updateState({ audioTracks: updated });

        if (this.playbackMode === "direct" && id === this.state.audioTracks[0]?.id) {
          return;
        }

        if (this.playbackMode === "direct" && id !== this.state.audioTracks[0]?.id) {
          this.playbackMode = "remux";
        }

        const currentPos = this.state.currentTime;
        const wasPlaying = !this.video.paused || !this.state.isPaused;
        await this.startStream(currentPos, wasPlaying);
        if (wasPlaying) {
          await this.video.play().catch(() => { });
        }
      }
    } else if (type === "sid") {
      this.subtitleRequestId++;
      const currentReqId = this.subtitleRequestId;

      if (id === "no" || id === "auto" || id === undefined) {
        this.selectedSubtitleIndex = "off";
        const updated = this.state.subtitleTracks.map((t) => ({
          ...t,
          selected: false,
        }));
        this.updateState({ subtitleTracks: updated });
        if (this.hlsInstance) {
          this.hlsInstance.subtitleTrack = -1;
          this.hlsInstance.subtitleDisplay = false;
        }
        if (this.video && (this.video as any).textTracks) {
          for (let i = 0; i < (this.video as any).textTracks.length; i++) {
            (this.video as any).textTracks[i].mode = "disabled";
          }
        }
        await this.queueSubtitleRender("off", currentReqId, null);
      } else if (typeof id === "number") {
        this.selectedSubtitleIndex = id;
        const updated = this.state.subtitleTracks.map((t) => ({
          ...t,
          selected: t.id === id,
        }));
        this.updateState({ subtitleTracks: updated });

        if (this.hlsInstance && id < 10000) {
          this.hlsInstance.subtitleTrack = id;
          this.hlsInstance.subtitleDisplay = true;
          if (this.jassub) {
            await this.jassub.clearTrack();
          }
          if (this.video && (this.video as any).textTracks) {
            for (let i = 0; i < (this.video as any).textTracks.length; i++) {
              (this.video as any).textTracks[i].mode =
                i === id ? "showing" : "disabled";
            }
          }
          return;
        }

        await this.queueSubtitleRender(id, currentReqId, null);

        if (id >= 10000 && id < 20000) {
          const extSub = this.externalSubtitles[id - 10000];
          const rawSubUrl = extSub?.url || extSub?.uri;
          if (rawSubUrl) {
            try {
              let text = this.subtitleContentMap.get(id);
              if (!text) {
                let fetchUrl = rawSubUrl;
                let subHeaders: Record<string, string> = { ...this.currentHeaders };

                if (fetchUrl.startsWith("file://")) {
                  fetchUrl = fetchUrl.replace(/^file:\/\//, "");
                }

                if (fetchUrl.startsWith("http://") || fetchUrl.startsWith("https://")) {
                  if (
                    !subHeaders["Referer"] &&
                    !subHeaders["referer"] &&
                    this.currentHeaders["Referer"]
                  ) {
                    subHeaders["Referer"] = this.currentHeaders["Referer"];
                  }
                  if (!subHeaders["User-Agent"] && !subHeaders["user-agent"]) {
                    subHeaders["User-Agent"] =
                      this.currentHeaders["User-Agent"] ||
                      this.currentHeaders["user-agent"] ||
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
                  }
                  const ref = subHeaders["Referer"] || subHeaders["referer"];
                  if (ref && !subHeaders["Origin"] && !subHeaders["origin"]) {
                    try {
                      subHeaders["Origin"] = new URL(ref).origin;
                    } catch {}
                  }

                  try {
                    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
                    const response = await tauriFetch(fetchUrl, {
                      headers: subHeaders,
                    });
                    if (response.ok) {
                      text = await response.text();
                    }
                  } catch (e) {
                    console.warn("[HtmlVideoEngine] tauriFetch failed for subtitle:", e);
                  }

                  if (
                    !text ||
                    (!text.includes("-->") &&
                      !text.includes("[Script Info]") &&
                      !text.includes("Dialogue:"))
                  ) {
                    try {
                      const response = await fetch(fetchUrl, {
                        headers: subHeaders,
                      });
                      if (response.ok) {
                        text = await response.text();
                      }
                    } catch {}
                  }
                } else {
                  try {
                    const { readTextFile } = await import("@tauri-apps/plugin-fs");
                    text = await readTextFile(fetchUrl);
                  } catch {
                    const response = await fetch(rawSubUrl);
                    text = await response.text();
                  }
                }

                if (
                  text &&
                  (text.includes("-->") ||
                    text.includes("[Script Info]") ||
                    text.includes("Dialogue:"))
                ) {
                  this.subtitleContentMap.set(id, text);
                }
              }

              if (
                this.subtitleRequestId === currentReqId &&
                this.selectedSubtitleIndex === id &&
                text &&
                text.trim() &&
                this.jassub
              ) {
                if (this.hlsInstance) {
                  this.hlsInstance.subtitleTrack = -1;
                }
                await this.queueSubtitleRender(id, currentReqId, text);
              }
            } catch (err) {
              console.warn("[HtmlVideoEngine] Failed to load external subtitle track:", err);
            }
          }
          return;
        }

        if (id >= 20000) {
          const cachedText = this.subtitleContentMap.get(id);
          if (
            this.subtitleRequestId === currentReqId &&
            this.selectedSubtitleIndex === id &&
            cachedText &&
            this.jassub
          ) {
            await this.queueSubtitleRender(id, currentReqId, cachedText);
          }
          return;
        }

        try {
          console.warn("[SubDebug] Starting extraction for track", id, "source:", this.currentSource?.substring(0, 80));
          const previousWindow = this.subtitleWindowContentMap.get(id);
          if (previousWindow && previousWindow.includes("-->")) {
            await this.queueSubtitleRender(id, currentReqId, previousWindow);
          }
          const windowText = await invoke<string>("extract_subtitle_window", {
            source: this.currentSource,
            trackIndex: id,
            startTime: this.state.currentTime,
            headers: this.currentHeaders,
          }).catch((error) => {
            console.warn(
              "[HtmlVideoEngine] Fast subtitle-window extraction failed:",
              error,
            );
            return "";
          });
          if (
            windowText &&
            windowText.includes("-->") &&
            this.subtitleRequestId === currentReqId &&
            this.selectedSubtitleIndex === id
          ) {
            this.subtitleWindowContentMap.set(id, windowText);
            this.subtitleContentMap.set(id, windowText);
            await this.queueSubtitleRender(id, currentReqId, windowText);
          }

          // Only start the complete extraction after the current-time window
          // is rendered. Running both FFmpeg reads together makes remote MKV
          // track switching slow and unreliable.
          void invoke<string>("extract_subtitles", {
            source: this.currentSource,
            trackIndex: id,
            headers: this.currentHeaders,
          })
            .then(async (subText) => {
              if (
                this.subtitleRequestId !== currentReqId ||
                this.selectedSubtitleIndex !== id ||
                !subText ||
                !subText.includes("-->")
              ) {
                return;
              }
              const currentWindow = this.subtitleWindowContentMap.get(id) || "";
              if (currentWindow) {
                // Progressive events will eventually deliver the completed
                // file. Keep the working current-time window until then.
                return;
              }
              const displayText = mergeSrtContent(subText, currentWindow);
              this.subtitleContentMap.set(id, displayText);
              await this.queueSubtitleRender(id, currentReqId, displayText);
            })
            .catch((error) => {
              console.warn(
                "[HtmlVideoEngine] Full subtitle extraction failed:",
                error,
              );
            });
        } catch (err) {
          console.warn("[HtmlVideoEngine] Failed to extract subtitle track:", err);
        }
      }
    } else if (type === "vid") {
      if (this.hlsInstance) {
        const targetLevel =
          id === "auto" || id === "no" || id === undefined
            ? -1
            : typeof id === "number"
            ? id
            : -1;
        this.hlsInstance.currentLevel = targetLevel;
        this.selectedVideoIndex = targetLevel;
        const updatedVideoTracks = this.state.videoTracks.map((t) => ({
          ...t,
          selected: targetLevel >= 0 && t.id === targetLevel,
        }));
        this.updateState({
          videoTracks: updatedVideoTracks,
          tracks: [
            ...updatedVideoTracks,
            ...this.state.audioTracks,
            ...this.state.subtitleTracks,
          ],
        });
        return;
      }
      if (typeof id === "number") {
        this.selectedVideoIndex = id;
        const currentPos = this.state.currentTime;
        const wasPlaying = !this.video.paused || !this.state.isPaused;
        await this.startStream(currentPos, wasPlaying);
        if (wasPlaying) {
          await this.video.play().catch(() => { });
        }
      }
    }
  }

  public async addSubtitleFile(path: string, title?: string): Promise<void> {
    try {
      let text = "";
      let fetchUrl = path;
      if (fetchUrl.startsWith("file://")) {
        fetchUrl = fetchUrl.replace(/^file:\/\//, "");
      }
      if (fetchUrl.startsWith("http://") || fetchUrl.startsWith("https://")) {
        try {
          const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
          const response = await tauriFetch(fetchUrl);
          text = await response.text();
        } catch {
          const response = await fetch(fetchUrl);
          text = await response.text();
        }
      } else {
        try {
          const { readTextFile } = await import("@tauri-apps/plugin-fs");
          text = await readTextFile(fetchUrl);
        } catch {
          const response = await fetch(path);
          text = await response.text();
        }
      }

      if (!text || !text.trim()) {
        console.warn("[HtmlVideoEngine] Subtitle content is empty:", path);
        return;
      }

      const newId = 20000 + Math.floor(Math.random() * 10000);
      this.subtitleContentMap.set(newId, text);
      const currentReqId = ++this.subtitleRequestId;
      this.selectedSubtitleIndex = newId;
      await this.queueSubtitleRender(newId, currentReqId, text);

      const filename = path.split("/").pop()?.split("\\").pop() || "External Subtitle";
      const newTrack: TrackInfo = {
        id: newId,
        type: "sub",
        title: title || filename,
        lang: "ext",
        codec: "ass",
        selected: true,
        external: true,
      };

      const updated = this.state.subtitleTracks.map((t) => ({
        ...t,
        selected: false,
      }));
      this.updateState({
        subtitleTracks: [...updated, newTrack],
        tracks: [
          ...this.state.tracks.filter((t) => t.type !== "sub"),
          ...updated,
          newTrack,
        ],
      });
    } catch (e) {
      console.warn("[HtmlVideoEngine] Failed to load external subtitle file:", e);
    }
  }

  public setExternalSubtitles(
    subs: { url?: string; uri?: string; language?: string; title?: string }[],
  ): void {
    if (!subs || subs.length === 0) return;
    this.externalSubtitles = subs;

    const seen = new Set<string>();
    const unique = subs.filter((s) => {
      const u = s.url || s.uri;
      if (!u || seen.has(u)) return false;
      seen.add(u);
      return true;
    });

    const extTracks: TrackInfo[] = unique.map((sub, idx) => ({
      id: 10000 + idx,
      type: "sub",
      title: sub.title || sub.language || `Subtitle ${idx + 1}`,
      lang: sub.language || "",
      codec: "srt",
      selected: this.selectedSubtitleIndex === 10000 + idx,
      external: true,
    }));

    const existingOtherTracks = this.state.subtitleTracks.filter(
      (t) => t.id < 10000 || t.id >= 20000,
    );

    const merged = [...existingOtherTracks, ...extTracks];
    this.updateState({
      subtitleTracks: merged,
      tracks: [
        ...this.state.tracks.filter((t) => t.type !== "sub"),
        ...merged,
      ],
    });
  }

  public setAudioDelay(delayMs: number): void {
    if (this.audioDelay === delayMs) return;
    this.audioDelay = delayMs;
    this.updateState({ audioDelay: delayMs });

    if (this.playbackMode === "direct" && delayMs !== 0) {
      this.playbackMode = "remux";
    }

    if (this.audioDelayDebounceTimer) {
      clearTimeout(this.audioDelayDebounceTimer);
    }

    this.audioDelayDebounceTimer = setTimeout(async () => {
      this.audioDelayDebounceTimer = null;
      const currentPos = this.state.currentTime;
      const wasPlaying = !this.video.paused || !this.state.isPaused;
      await this.startStream(currentPos, wasPlaying);
      if (wasPlaying) {
        await this.video.play().catch(() => { });
      }
    }, 250);
  }

  public setSubtitleDelay(delayMs: number): void {
    if (this.subtitleDelay === delayMs) return;
    this.subtitleDelay = delayMs;
    this.updateState({ subtitleDelay: delayMs });
    this.updateJassubTimeOffset();
  }

  public async updateSubtitleSettings(): Promise<void> {
    if (this.jassub) {
      await this.jassub.updateSubtitleSettings();
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.listeners.clear();
    this.subtitleContentMap.clear();

    if (this.seekSafetyTimer) {
      clearTimeout(this.seekSafetyTimer);
      this.seekSafetyTimer = null;
    }

    if (this.audioDelayDebounceTimer) {
      clearTimeout(this.audioDelayDebounceTimer);
      this.audioDelayDebounceTimer = null;
    }

    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }

    if (this.proxyPort && this.sessionId) {
      fetch(`http://127.0.0.1:${this.proxyPort}/remux/cancel?session_id=${this.sessionId}`).catch(
        () => { },
      );
    }

    if (this.unlistenSubtitles) {
      this.unlistenSubtitles();
      this.unlistenSubtitles = null;
    }

    if (this.unlistenStreamInfo) {
      this.unlistenStreamInfo();
      this.unlistenStreamInfo = null;
    }

    if (this.jassub) {
      this.jassub.destroy();
      this.jassub = null;
    }

    if (this.freezeCanvas) {
      this.freezeCanvas.remove();
      this.freezeCanvas = null;
    }

    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();

    if (this.currentTorrentInfoHash) {
      const infoHash = this.currentTorrentInfoHash;
      this.currentTorrentInfoHash = null;
      deleteTorrentStream(infoHash).catch((err) => {
        console.warn("[HtmlVideoEngine] Failed to delete torrent stream on destroy:", err);
      });
    }
  }
}

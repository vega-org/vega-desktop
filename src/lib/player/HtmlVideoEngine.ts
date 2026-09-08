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
  requested_start: number;
  actual_start: number;
  initial_skip: number;
}

const WEB_FRIENDLY_AUDIO_CODECS = new Set([
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
]);

function isVideoCodecSupported(codecName?: string): boolean {
  if (!codecName) return true;
  if (typeof window === "undefined" || !window.MediaSource) return true;
  const name = codecName.toLowerCase();

  try {
    if (name.includes("h264") || name.includes("avc")) {
      return (
        MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028, mp4a.40.2"') ||
        MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"')
      );
    }
    if (name.includes("hevc") || name.includes("h265")) {
      return (
        MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L93.B0, mp4a.40.2"') ||
        MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0, mp4a.40.2"')
      );
    }
    if (name.includes("av1") || name.includes("av01")) {
      return MediaSource.isTypeSupported('video/mp4; codecs="av01.0.08M.08, mp4a.40.2"');
    }
    if (name.includes("vp9")) {
      return MediaSource.isTypeSupported('video/webm; codecs="vp9, opus"');
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
  private subtitleContentMap: Map<number, string> = new Map();

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
          this.updateJassubTimeOffset();
          if (event.payload.subtitles && event.payload.subtitles.trim() && event.payload.subtitles.includes("-->")) {
            console.warn("[SubDebug] Applying progressive subtitle update, length:", event.payload.subtitles.length);
            await this.jassub.setTrackContent(event.payload.subtitles);
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

  private applyStreamInfo(info: RemuxStreamInfo): void {
    const { actual_start, requested_start } = info;
    if (Math.abs(requested_start - this.requestedStartTime) > 0.5) {
      console.log(
        `[HtmlVideoEngine] Discarding stale stream info: requested=${requested_start.toFixed(3)}s, currentTarget=${this.requestedStartTime.toFixed(3)}s`,
      );
      return;
    }
    console.log(
      `[HtmlVideoEngine] Remux stream timing aligned: requested=${requested_start.toFixed(3)}s, actual=${actual_start.toFixed(3)}s`,
    );
    this.virtualTimeOffset = actual_start;
    this.updateJassubTimeOffset();
    if (!this.isSeeking) {
      this.updateState({ currentTime: this.virtualTimeOffset + this.video.currentTime });
    }
  }

  private async checkStreamInfoFallback(): Promise<void> {
    if (this.playbackMode === "direct" || !this.proxyPort || !this.sessionId) return;
    try {
      const resp = await fetch(
        `http://127.0.0.1:${this.proxyPort}/remux/info?session_id=${this.sessionId}`,
      );
      if (resp.ok) {
        const info = await resp.json();
        if (info && info.session_id === this.sessionId) {
          this.applyStreamInfo(info);
        }
      }
    } catch { }
  }

  public get state(): PlayerEngineState {
    return this._state;
  }

  public get selectedSubtitle(): number | "off" {
    return this.selectedSubtitleIndex;
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
      const baseOffset = this.playbackMode === "direct" ? 0 : this.virtualTimeOffset;
      const delayOffset = -(this.subtitleDelay / 1000);
      this.jassub.setTimeOffset(baseOffset + delayOffset);
    }
  }

  private attachVideoListeners(): void {
    const v = this.video;

    v.addEventListener("play", () => {
      this.updateState({ isPaused: false });
    });

    v.addEventListener("pause", () => {
      this.updateState({ isPaused: true, isBuffering: false });
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
        this.playbackMode === "direct"
          ? v.currentTime
          : this.virtualTimeOffset + v.currentTime;
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
      finishSeeking();
      this.updateState({ isBuffering: false, isPaused: false });
      if (this.jassub) {
        this.jassub.setBuffering(false);
        this.jassub.resize();
      }
    });

    v.addEventListener("canplay", () => {
      finishSeeking();
      this.updateState({ isBuffering: false });
      if (this.playbackMode === "remux") {
        void this.checkStreamInfoFallback();
      }
      if (this.jassub) {
        this.jassub.setBuffering(false);
        this.jassub.resize();
      }
    });

    v.addEventListener("canplaythrough", () => {
      this.updateState({ isBuffering: false });
      if (this.jassub) {
        this.jassub.setBuffering(false);
      }
    });

    v.addEventListener("loadeddata", () => {
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
      if (this.playbackMode === "remux") {
        void this.checkStreamInfoFallback();
      }
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
      const err = v.error;
      const msg = err ? `Video error code ${err.code}: ${err.message}` : "Playback error";
      console.warn("[HtmlVideoEngine] Video element error:", msg);
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
    this.selectedSubtitleIndex = "off";
    this.subtitleContentMap.clear();
    if (this.jassub) {
      this.jassub.clearTrack().catch(() => { });
      this.updateJassubTimeOffset();
    }

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
          !source.startsWith("blob:");

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

      await this.startStream(this.virtualTimeOffset);

      if (options?.autoPlay !== false) {
        await this.play().catch((e) => {
          console.warn("[HtmlVideoEngine] Autoplay prevented or delayed:", e);
          this.updateState({ isPaused: true, isBuffering: false });
        });
      }
    } catch (err: any) {
      console.warn("[HtmlVideoEngine] Playback setup error:", err);
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
      if (this.currentHeaders.Referer) params.set("referer", this.currentHeaders.Referer);
      if (this.currentHeaders["User-Agent"]) params.set("ua", this.currentHeaders["User-Agent"]);
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

      const videoTracks: TrackInfo[] = [
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

  private async startStream(startTime: number): Promise<void> {
    this.requestedStartTime = startTime;
    this.virtualTimeOffset = startTime;
    this.updateJassubTimeOffset();
    const port = await this.getProxyPort();
    const isLocal =
      !this.currentSource.startsWith("http://") &&
      !this.currentSource.startsWith("https://") &&
      !this.currentSource.startsWith("asset://") &&
      !this.currentSource.startsWith("blob:");

    const hasHeaders = Object.keys(this.currentHeaders).length > 0;

    if (this.playbackMode === "direct" && this.audioDelay === 0) {
      if (isLocal) {
        this.video.src = `http://127.0.0.1:${port}/file?path=${encodeURIComponent(this.currentSource)}`;
        if (startTime > 0) {
          this.video.currentTime = startTime;
        }
        this.video.load();
        return;
      } else if (!hasHeaders) {
        this.video.src = this.currentSource;
        if (startTime > 0) {
          this.video.currentTime = startTime;
        }
        this.video.load();
        return;
      }
      // If direct mode has custom headers, route through remux proxy which injects headers!
    }

    const params = new URLSearchParams();
    params.set("url", this.currentSource);
    params.set("mode", this.playbackMode === "direct" ? "remux" : this.playbackMode);
    params.set("session_id", this.sessionId);

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

    if (this.selectedVideoIndex !== null) {
      params.set("video_index", String(this.selectedVideoIndex));
    }

    if (this.currentHeaders.Referer) {
      params.set("referer", this.currentHeaders.Referer);
    }
    if (this.currentHeaders["User-Agent"]) {
      params.set("ua", this.currentHeaders["User-Agent"]);
    }
    if (this.currentHeaders.Origin) {
      params.set("origin", this.currentHeaders.Origin);
    }

    const streamUrl = `http://127.0.0.1:${port}/remux?${params.toString()}`;
    this.video.src = streamUrl;
    this.video.load();
  }

  public async play(): Promise<void> {
    return this.video.play();
  }

  public pause(): void {
    this.video.pause();
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
    }, 1500);

    if (this.hlsInstance || this.playbackMode === "direct") {
      this.video.currentTime = clamped;
      this.updateState({ currentTime: clamped, isBuffering: true });
      return;
    }

    this.virtualTimeOffset = clamped;
    this.updateJassubTimeOffset();
    this.updateState({ currentTime: clamped, isBuffering: true });

    const wasPlaying = !this.video.paused || !this.state.isPaused;
    await this.startStream(clamped);

    if (wasPlaying) {
      await this.video.play().catch(() => { });
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
        await this.startStream(currentPos);
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
        }
        if (this.jassub) {
          await this.jassub.clearTrack();
        }
      } else if (typeof id === "number") {
        this.selectedSubtitleIndex = id;
        const updated = this.state.subtitleTracks.map((t) => ({
          ...t,
          selected: t.id === id,
        }));
        this.updateState({ subtitleTracks: updated });

        if (this.hlsInstance && id < 10000) {
          this.hlsInstance.subtitleTrack = id;
          return;
        }

        if (this.jassub) {
          await this.jassub.clearTrack();
        }

        if (id >= 10000 && id < 20000) {
          const extSub = this.externalSubtitles[id - 10000];
          const subUrl = extSub?.url || extSub?.uri;
          if (subUrl) {
            try {
              let text = this.subtitleContentMap.get(id);
              if (!text) {
                let fetchUrl = subUrl;
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
                    const response = await fetch(subUrl);
                    text = await response.text();
                  }
                }
                if (text) {
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
                this.updateJassubTimeOffset();
                await this.jassub.setTrackContent(text);
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
            this.updateJassubTimeOffset();
            await this.jassub.setTrackContent(cachedText);
          }
          return;
        }

        try {
          console.warn("[SubDebug] Starting extraction for track", id, "source:", this.currentSource?.substring(0, 80));
          const subText = await invoke<string>("extract_subtitles", {
            source: this.currentSource,
            trackIndex: id,
            headers: this.currentHeaders,
          });

          if (
            this.subtitleRequestId === currentReqId &&
            this.selectedSubtitleIndex === id &&
            this.jassub
          ) {
            this.updateJassubTimeOffset();
            if (subText && subText.trim() && subText.includes("-->")) {
              this.subtitleContentMap.set(id, subText);
              await this.jassub.setTrackContent(subText);
            }
          }
        } catch (err) {
          console.warn("[HtmlVideoEngine] Failed to extract subtitle track:", err);
        }
      }
    } else if (type === "vid") {
      if (typeof id === "number") {
        this.selectedVideoIndex = id;
        const currentPos = this.state.currentTime;
        const wasPlaying = !this.video.paused || !this.state.isPaused;
        await this.startStream(currentPos);
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

      if (this.jassub) {
        this.updateJassubTimeOffset();
        await this.jassub.setTrackContent(text);
      }

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

      this.selectedSubtitleIndex = newId;
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
      await this.startStream(currentPos);
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

    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
  }
}

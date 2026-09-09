export interface TrackInfo {
  id: number;
  type: "video" | "audio" | "sub";
  title: string;
  lang: string;
  codec: string;
  selected: boolean;
  external: boolean;
  isBitmapSub?: boolean;
  is_default?: boolean;
  demuxW?: number;
  demuxH?: number;
}

export interface ChapterInfo {
  title: string;
  time: number;
}

export type MpvTrack = TrackInfo;
export type MpvChapter = ChapterInfo;

export interface PlayerEngineState {
  isInitialized: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  speed: number;
  isBuffering: boolean;
  cacheDuration: number;
  tracks: TrackInfo[];
  audioTracks: TrackInfo[];
  subtitleTracks: TrackInfo[];
  videoTracks: TrackInfo[];
  chapters: ChapterInfo[];
  videoHeight: number;
  error: string | null;
  audioDelay?: number;
  subtitleDelay?: number;
}

export interface PlayerEngineOptions {
  headers?: Record<string, string>;
  startTime?: number;
  autoPlay?: boolean;
  audioIndex?: number;
  subtitleIndex?: number | "off";
  subtitles?: { url?: string; uri?: string; language?: string; title?: string }[];
}

export interface PlayerEngine {
  readonly state: PlayerEngineState;
  readonly source?: string;
  readonly headers?: Record<string, string>;
  subscribe(listener: (state: PlayerEngineState) => void): () => void;
  load(source: string, options?: PlayerEngineOptions): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(time: number): Promise<void>;
  setVolume(volume: number): void;
  setSpeed(speed: number): void;
  selectTrack(type: "aid" | "sid" | "vid", id: number | "no" | "auto"): Promise<void>;
  addSubtitleFile?(path: string, title?: string): Promise<void>;
  setExternalSubtitles?(subs: { url?: string; uri?: string; language?: string; title?: string }[]): void;
  setAudioDelay?(delayMs: number): Promise<void> | void;
  setSubtitleDelay?(delayMs: number): Promise<void> | void;
  updateSubtitleSettings?(): Promise<void> | void;
  destroy(): void;
}

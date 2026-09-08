import JASSUB from "jassub";
import { convertSubToAss } from "./subUtils";

export class JassubManager {
  private instance: JASSUB | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private activeSubtitle: string | null = null;
  private rawSubtitle: string | null = null;
  private timeOffset: number = 0;
  private probedWidth: number = 0;
  private probedHeight: number = 0;
  private isDestroyed = false;
  private isBuffering = false;
  private boundVideoListeners: Array<{ target: EventTarget; event: string; fn: () => void }> = [];

  constructor(video: HTMLVideoElement) {
    this.videoElement = video;
    this.attachVideoListeners();
  }

  private attachVideoListeners(): void {
    if (!this.videoElement) return;

    const onReadyOrUpdate = () => {
      if (this.instance && this.activeSubtitle) {
        this.resize();
      }
    };

    const onWaiting = () => {
      this.isBuffering = true;
    };

    const onPlaying = () => {
      this.isBuffering = false;
      if (this.instance && this.activeSubtitle) {
        this.resize();
      }
    };

    this.videoElement.addEventListener("waiting", onWaiting);
    this.boundVideoListeners.push({ target: this.videoElement, event: "waiting", fn: onWaiting });

    this.videoElement.addEventListener("playing", onPlaying);
    this.boundVideoListeners.push({ target: this.videoElement, event: "playing", fn: onPlaying });

    const events = ["loadedmetadata", "loadeddata", "canplay", "pause", "seeked"];
    for (const evt of events) {
      this.videoElement.addEventListener(evt, onReadyOrUpdate);
      this.boundVideoListeners.push({ target: this.videoElement, event: evt, fn: onReadyOrUpdate });
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", onReadyOrUpdate);
      this.boundVideoListeners.push({ target: window, event: "resize", fn: onReadyOrUpdate });
    }
  }

  public setBuffering(buffering: boolean): void {
    this.isBuffering = buffering;
    if (!buffering && this.instance && this.videoElement && this.activeSubtitle) {
      this.triggerImmediateRender().catch(() => {});
    }
  }

  public get currentSubtitle(): string | null {
    return this.activeSubtitle;
  }

  public setVideoDimensions(width: number, height: number): void {
    if (width > 0 && height > 0) {
      this.probedWidth = width;
      this.probedHeight = height;
      if (this.instance && this.activeSubtitle) {
        this.resize();
      }
    }
  }

  public setTimeOffset(offset: number): void {
    this.timeOffset = offset;
    if (this.instance) {
      this.instance.timeOffset = offset;
      this.triggerImmediateRender();
    }
  }

  private updateCanvasBounds(): { width: number; height: number; renderW: number; renderH: number } {
    if (!this.videoElement) {
      return { width: 1920, height: 1080, renderW: 1920, renderH: 1080 };
    }
    const v = this.videoElement;
    const clientW = v.clientWidth || window.innerWidth || 1920;
    const clientH = v.clientHeight || window.innerHeight || 1080;
    const vidW = v.videoWidth || this.probedWidth || 1920;
    const vidH = v.videoHeight || this.probedHeight || 1080;

    const videoRatio = vidW / vidH;
    const elementRatio = clientW / clientH;
    let w = clientW;
    let h = clientH;
    if (elementRatio > videoRatio) {
      h = clientH;
      w = Math.round(clientH * videoRatio);
    } else {
      w = clientW;
      h = Math.round(clientW / videoRatio);
    }
    const x = Math.round((clientW - w) / 2);
    const y = Math.round((clientH - h) / 2);

    const canvas = (this.instance as any)?._canvas as HTMLCanvasElement | undefined;
    if (canvas) {
      canvas.style.position = "absolute";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "1";
      canvas.style.left = `${x}px`;
      canvas.style.top = `${y}px`;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    const dpr = window.devicePixelRatio || 1;
    return {
      width: vidW,
      height: vidH,
      renderW: Math.round(w * dpr),
      renderH: Math.round(h * dpr),
    };
  }

  private async triggerImmediateRender(overrideTime?: number): Promise<void> {
    if (!this.instance || !this.videoElement || (this.isBuffering && overrideTime === undefined)) return;
    try {
      await this.instance.ready;
      const { width, height, renderW, renderH } = this.updateCanvasBounds();
      const v = this.videoElement;
      const t = (overrideTime !== undefined ? overrideTime : v.currentTime) + this.timeOffset;
      const renderer = (this.instance.renderer as any);
      if (renderer?._resizeCanvas) {
        await renderer._resizeCanvas(renderW, renderH, width, height).catch(() => {});
      }
      if (renderer?._draw) {
        await renderer._draw(t, true).catch(() => {});
      }
    } catch {
      // Ignored
    }
  }

  public renderFrame(time?: number): void {
    this.triggerImmediateRender(time).catch(() => {});
  }

  private async createInstance(assContent: string): Promise<void> {
    if (!this.videoElement || this.isDestroyed) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const defaultFontUrl = `${origin}/jassub/default.woff2`;
    const wasmUrl = `${origin}/jassub/jassub-worker.wasm`;
    const modernWasmUrl = `${origin}/jassub/jassub-worker-modern.wasm`;

    try {
      this.instance = new JASSUB({
        video: this.videoElement,
        subContent: assContent,
        timeOffset: this.timeOffset,
        fonts: [defaultFontUrl],
        defaultFont: "liberation sans",
        wasmUrl,
        modernWasmUrl,
      });

      const origManualRender = this.instance.manualRender.bind(this.instance);
      (this.instance as any).manualRender = (data: any, repaint = false) => {
        if (this.isBuffering) {
          return;
        }
        return origManualRender(data, repaint);
      };

      await this.instance.ready;
      this.updateCanvasBounds();
      await this.triggerImmediateRender();
    } catch (err) {
      console.warn("[JassubManager] Failed to instantiate JASSUB:", err);
    }
  }

  public async setTrackContent(rawContent: string): Promise<void> {
    if (this.isDestroyed || !this.videoElement) return;

    this.rawSubtitle = rawContent;
    const assContent = convertSubToAss(rawContent);
    this.activeSubtitle = assContent;

    if (!assContent || !assContent.trim()) {
      await this.clearTrack();
      return;
    }

    if (!this.instance) {
      await this.createInstance(assContent);
    } else {
      try {
        await this.instance.ready;
        this.instance.timeOffset = this.timeOffset;
        await (this.instance.renderer as any).freeTrack().catch(() => {});
        await (this.instance.renderer as any).setTrack(assContent);
        this.updateCanvasBounds();
        await this.triggerImmediateRender();
      } catch (err) {
        console.warn("[JassubManager] Failed to update subtitle track, recreating instance:", err);
        try {
          await this.instance.destroy().catch(() => {});
        } catch {}
        this.instance = null;
        await this.createInstance(assContent);
      }
    }
  }

  public async updateSubtitleSettings(): Promise<void> {
    if (!this.rawSubtitle || this.isDestroyed || !this.instance) return;
    const assContent = convertSubToAss(this.rawSubtitle);
    this.activeSubtitle = assContent;
    try {
      await this.instance.ready;
      this.instance.timeOffset = this.timeOffset;
      await (this.instance.renderer as any).freeTrack().catch(() => {});
      await (this.instance.renderer as any).setTrack(assContent);
      this.updateCanvasBounds();
      await this.triggerImmediateRender();
    } catch (err) {
      console.warn("[JassubManager] Failed to update subtitle settings:", err);
    }
  }

  public async clearTrack(): Promise<void> {
    this.activeSubtitle = null;
    this.rawSubtitle = null;
    if (this.instance) {
      try {
        await this.instance.ready;
        await (this.instance.renderer as any).freeTrack().catch(() => {});
        await this.triggerImmediateRender();
      } catch (err) {
        console.warn("[JassubManager] Failed to clear track:", err);
      }
    }
  }

  public resize(): void {
    this.triggerImmediateRender().catch(() => {});
  }

  public destroy(): void {
    this.isDestroyed = true;
    for (const { target, event, fn } of this.boundVideoListeners) {
      target.removeEventListener(event, fn);
    }
    this.boundVideoListeners = [];

    if (this.instance) {
      try {
        this.instance.destroy().catch(() => {});
      } catch {
        // Ignored
      }
      this.instance = null;
    }
    this.videoElement = null;
    this.activeSubtitle = null;
  }
}

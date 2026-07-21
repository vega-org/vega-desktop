import { useEffect, useRef, useState, useCallback } from "react";
import {
  init,
  destroy,
  command,
  setProperty,
  getProperty,
  observeProperties,
  listenEvents,
  type MpvObservableProperty,
} from "tauri-plugin-libmpv-api";
import { settingsStorage } from "../storage/SettingsStorage";

const OBSERVED_PROPERTIES = [
  ["pause", "flag"],
  ["time-pos", "double", "none"],
  ["duration", "double", "none"],
  ["volume", "double"],
  ["speed", "double"],
  ["eof-reached", "flag"],
  ["paused-for-cache", "flag"],
  ["demuxer-cache-duration", "double", "none"],
  ["track-list/count", "int64"],
  ["video-params/h", "double"],
] as const satisfies MpvObservableProperty[];

export interface MpvTrack {
  id: number;
  type: "audio" | "video" | "sub";
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
let currentActiveTorrentInfoHash: string | null = null;
let currentActiveTorrentApiPort: number | null = null;
let currentActiveTorrentUrl: string | null = null;
let currentLoadFileAbortController: AbortController | null = null;

export interface UseMpvPlayerOptions {
  onEof?: () => void;
  onFileLoaded?: () => void;
}

export const useMpvPlayer = (opts?: UseMpvPlayerOptions) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(
    null,
  );
  const [isPaused, setIsPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1.0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [cacheDuration, setCacheDuration] = useState(0);
  const [tracks, setTracks] = useState<MpvTrack[]>([]);
  const [videoHeight, setVideoHeight] = useState(0);

  const unlistenPropsRef = useRef<(() => void) | null>(null);
  const unlistenEventsRef = useRef<(() => void) | null>(null);
  const pendingSubsRef = useRef<
    { url?: string; uri?: string; language?: string; title?: string }[]
  >([]);
  const optsRef = useRef(opts);
  const initCounterRef = useRef(0);
  optsRef.current = opts;

  // ... fetchTracks is unchanged ...
  const fetchTracks = useCallback(async () => {
    try {
      const count = (await getProperty("track-list/count", "int64")) as number;
      if (!count || count <= 0) return;

      const parsed: MpvTrack[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const type = (await getProperty(
            `track-list/${i}/type`,
            "string",
          )) as string;
          const id = (await getProperty(
            `track-list/${i}/id`,
            "int64",
          )) as number;
          const title = (await getProperty(
            `track-list/${i}/title`,
            "string",
          ).catch(() => "")) as string;
          const lang = (await getProperty(
            `track-list/${i}/lang`,
            "string",
          ).catch(() => "")) as string;
          const codec = (await getProperty(
            `track-list/${i}/codec`,
            "string",
          ).catch(() => "")) as string;
          const selected = (await getProperty(
            `track-list/${i}/selected`,
            "flag",
          ).catch(() => false)) as boolean;
          const external = (await getProperty(
            `track-list/${i}/external`,
            "flag",
          ).catch(() => false)) as boolean;
          const demuxW = (await getProperty(
            `track-list/${i}/demux-w`,
            "int64",
          ).catch(() => undefined)) as number | undefined;
          const demuxH = (await getProperty(
            `track-list/${i}/demux-h`,
            "int64",
          ).catch(() => undefined)) as number | undefined;

          parsed.push({
            id,
            type: type as MpvTrack["type"],
            title: title || "",
            lang: lang || "",
            codec: codec || "",
            selected: selected || false,
            external: external || false,
            demuxW,
            demuxH,
          });
        } catch (err) {}
      }
      setTracks(parsed);
    } catch (err: any) {
      if (String(err).includes("instance not found")) return;
      console.error("Failed to fetch tracks:", err);
    }
  }, []);

  const initPlayer = useCallback(async () => {
    setInitializationError(null);
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
            "keep-open": "yes",
            "force-window": "no",
            "osd-level": "0",
            "sub-auto": "fuzzy",
            "sub-font-size": (
              settingsStorage.getSubtitleFontSize() || 36
            ).toString(),
            "sub-border-size": "2",
            "sub-shadow-offset": "1",
            "sub-margin-y": (
              settingsStorage.getSubtitleBottomPadding() || 36
            ).toString(),
            "sub-ass-override": "force",
            "demuxer-lavf-o": "fflags=+genpts",
          };

          if (hwAccel) {
            initialOptions["vo"] = "gpu-next";
            initialOptions["hwdec"] = "auto-safe";
          }

          await init({
            initialOptions,
            observedProperties: OBSERVED_PROPERTIES,
          });
        } catch (err) {
          console.error("Failed to initialize mpv:", err);
          globalInitPromise = null;
          throw err;
        }
      })();
    }

    try {
      await globalInitPromise;
    } catch (err) {
      setInitializationError(err instanceof Error ? err.message : String(err));
      return;
    }

    if (currentInit !== initCounterRef.current) return;

    try {
      const unlisten = await observeProperties(
        OBSERVED_PROPERTIES,
        ({ name, data }) => {
          switch (name) {
            case "pause":
              setIsPaused(data as boolean);
              break;
            case "time-pos":
              if (data !== null) setCurrentTime(data as number);
              break;
            case "duration":
              if (data !== null) setDuration(data as number);
              break;
            case "demuxer-cache-duration":
              if (data !== null) setCacheDuration(data as number);
              break;
            case "volume":
              setVolume(data as number);
              break;
            case "speed":
              setSpeed(data as number);
              break;
            case "eof-reached":
              if (data === true) optsRef.current?.onEof?.();
              break;
            case "paused-for-cache":
              setIsBuffering(data as boolean);
              break;
            case "track-list/count":
              fetchTracks();
              break;
            case "video-params/h":
              if (data !== null) setVideoHeight(data as number);
              break;
          }
        },
      );

      if (currentInit !== initCounterRef.current) {
        unlisten();
        return;
      }
      unlistenPropsRef.current = unlisten;

      const unlistenEvt = await listenEvents((event) => {
        if (event.event === "log-message") {
          const text = (event as any).text;
          const level = (event as any).level;
          if (
            level === "error" ||
            level === "warn" ||
            level === "info" ||
            (text && text.includes("http"))
          ) {
            console.log(`[MPV LOG] [${level}] ${text?.trim()}`);
          }
        }
        if (event.event === "file-loaded") {
          console.log("mpv: file-loaded");
          setIsBuffering(false);
          getProperty("pause", "flag")
            .then((p) => setIsPaused(p as boolean))
            .catch(() => {});

          if (optsRef.current?.onFileLoaded) {
            optsRef.current.onFileLoaded();
          }

          if (pendingSubsRef.current && pendingSubsRef.current.length > 0) {
            setTimeout(async () => {
              for (const sub of pendingSubsRef.current) {
                let subUrl = sub.uri || sub.url;
                if (subUrl) {
                  subUrl = subUrl.replace(/\\/g, "/");
                  try {
                    await command("sub-add", [
                      subUrl,
                      "auto",
                      sub.title || sub.language || "External",
                    ]);
                  } catch (e) {
                    console.error("Failed to add sub:", e);
                  }
                }
              }
              pendingSubsRef.current = [];
              setTimeout(fetchTracks, 1000);
            }, 500);
          }
        }
        if (event.event === "seek") {
          setIsBuffering(true);
        }
        if (event.event === "playback-restart") {
          setIsBuffering(false);
          getProperty("pause", "flag")
            .then((p) => setIsPaused(p as boolean))
            .catch(() => {});
        }
        if (event.event === "end-file") {
          console.log("mpv: end-file", event);
          setIsBuffering(false);
          setCurrentTime(0);
          setDuration(0);
        }
      });

      if (currentInit !== initCounterRef.current) {
        unlistenEvt();
        return;
      }
      unlistenEventsRef.current = unlistenEvt;

      setIsInitialized(true);
      console.log("mpv: initialized");
    } catch (err) {
      console.error("Failed to attach listeners:", err);
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
            console.log("mpv: destroyed");
            if (currentActiveTorrentInfoHash && currentActiveTorrentApiPort) {
              await fetch(
                `http://127.0.0.1:${currentActiveTorrentApiPort}/torrents/${currentActiveTorrentInfoHash}/delete`,
                { method: "POST" },
              ).catch(() => {});
              currentActiveTorrentInfoHash = null;
              currentActiveTorrentApiPort = null;
              currentActiveTorrentUrl = null;
            }
          } catch (err) {
            console.error("Failed to destroy mpv:", err);
          } finally {
            globalInitPromise = null;
            destroyPromise = null;
          }
        })();
      }, 500);
    } else {
      try {
        command("stop").catch(() => {});
      } catch {}
    }
  }, []);

  const loadFile = useCallback(
    async (
      url: string,
      headers?: Record<string, string>,
      subtitles?: any[],
      type?: string,
    ) => {
      if (!isInitialized) return;

      if (
        currentActiveTorrentUrl !== url &&
        currentActiveTorrentInfoHash &&
        currentActiveTorrentApiPort
      ) {
        fetch(
          `http://127.0.0.1:${currentActiveTorrentApiPort}/torrents/${currentActiveTorrentInfoHash}/delete`,
          { method: "POST" },
        ).catch(() => {});
        currentActiveTorrentInfoHash = null;
        currentActiveTorrentApiPort = null;
        currentActiveTorrentUrl = null;
      }

      if (currentLoadFileAbortController) {
        currentLoadFileAbortController.abort();
      }
      const abortController = new AbortController();
      currentLoadFileAbortController = abortController;

      setIsBuffering(true);
      setTracks([]);
      pendingSubsRef.current = subtitles || [];
      try {
        let ua =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        let referer = "";

        if (headers && Object.keys(headers).length > 0) {
          const headerList: string[] = [];
          for (const [k, v] of Object.entries(headers)) {
            const lowerK = k.toLowerCase();
            if (lowerK === "user-agent") {
              ua = v;
            } else if (lowerK === "referer") {
              referer = v;
            }

            let val = `${k}: ${v}`;
            if (val.includes(",")) {
              val = `"${val.replace(/"/g, '\\"')}"`;
            }
            headerList.push(val);
          }

          await setProperty("http-header-fields", headerList.join(",")).catch(
            (e) => console.error("Failed to set headers:", e),
          );
        } else {
          await setProperty("http-header-fields", "").catch(() => {});
        }

        let finalUrl = url;
        let isProxied = false;
        let isTorrent = false;

        console.log(
          "[MPV debug] type:",
          type,
          "url starts with magnet:",
          url.startsWith("magnet:"),
        );
        if (type === "torrent" || url.startsWith("magnet:")) {
          try {
            console.log("[MPV debug] entering torrent block");
            const { invoke } = await import("@tauri-apps/api/core");
            const apiPort = await invoke<number>("get_torrent_api_port");
            console.log("[MPV debug] get_torrent_api_port returned:", apiPort);
            if (apiPort) {
              currentActiveTorrentApiPort = apiPort;
              console.log("[MPV torrent] api port:", apiPort);

              let infoHash = currentActiveTorrentInfoHash;
              let torrentFiles: any[] = [];
              if (currentActiveTorrentUrl !== url || !infoHash) {
                console.log("[MPV debug] sending POST /torrents for:", url);
                const addRes = await fetch(
                  `http://127.0.0.1:${apiPort}/torrents`,
                  {
                    method: "POST",
                    body: url,
                    signal: abortController.signal,
                  },
                );

                if (!addRes.ok) {
                  throw new Error(
                    `Failed to add torrent: ${addRes.status} ${await addRes.text()}`,
                  );
                }

                console.log("[MPV debug] POST /torrents resolved");
                const addData = await addRes.json();
                infoHash = addData.details.info_hash;
                torrentFiles = addData.details.files || [];
                currentActiveTorrentInfoHash = infoHash;
                currentActiveTorrentUrl = url;
              }
              // Wait for torrent to leave "initializing" state
              const liveDeadline = Date.now() + 120000;
              while (Date.now() < liveDeadline) {
                if (abortController.signal.aborted) throw new Error("Aborted");
                try {
                  const statsRes = await fetch(
                    `http://127.0.0.1:${apiPort}/torrents/${infoHash}/stats/v1`,
                    { signal: abortController.signal },
                  );
                  if (statsRes.ok) {
                    const stats = await statsRes.json();
                    console.log("[MPV torrent] state:", stats.state);
                    if (stats.state === "live" || stats.state === "paused")
                      break;
                    if (stats.state === "error")
                      throw new Error(`Torrent error: ${stats.error}`);
                  }
                } catch (err: any) {
                  if (err.name === "AbortError" || err.message === "Aborted")
                    throw err;
                }
                await new Promise((r) => setTimeout(r, 500));
              }

              const fileId = 0;
              const rawName = torrentFiles[0]?.name || "";
              const fileName = rawName.substring(
                Math.max(rawName.lastIndexOf("/"), rawName.lastIndexOf("\\")) +
                  1,
              );

              const nameSuffix = fileName
                ? `/${encodeURIComponent(fileName)}`
                : "";
              const streamUrl = `http://127.0.0.1:${apiPort}/torrents/${infoHash}/stream/${fileId}${nameSuffix}`;

              // Warm up the stream — fetch the first chunk so librqbit
              // prioritizes downloading the beginning of the file.
              const dataDeadline = Date.now() + 60000;
              while (Date.now() < dataDeadline) {
                if (abortController.signal.aborted) throw new Error("Aborted");
                try {
                  const probeRes = await fetch(streamUrl, {
                    signal: abortController.signal,
                    headers: { Range: "bytes=0-1048575" },
                  });
                  if (probeRes.ok || probeRes.status === 206) {
                    const buf = await probeRes.arrayBuffer();
                    console.log(
                      "[MPV torrent] stream warmed up, got",
                      buf.byteLength,
                      "bytes",
                    );
                    break;
                  }
                } catch (err: any) {
                  if (err.name === "AbortError" || err.message === "Aborted")
                    throw err;
                }
                await new Promise((r) => setTimeout(r, 1000));
              }

              finalUrl = streamUrl;
              console.log("[MPV torrent] Streaming file", fileId, finalUrl);
              isProxied = true;
              isTorrent = true;
            } else {
              console.log("[MPV debug] apiPort is falsy!");
            }
          } catch (e: any) {
            if (e.name === "AbortError" || e.message === "Aborted") {
              console.log("[MPV torrent] Stream fetch aborted");
              throw e; // rethrow to outer catch block
            }
            console.error("Failed torrent stream", e);
            throw e;
          }
        } else if (url.startsWith("http")) {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const port = await invoke<number | null>("get_stream_proxy_port");
            const shouldProxy = url.includes(".m3u8") || type === "m3u8";
            const proxyPort = port;
            console.log("[MPV proxy] port:", proxyPort);
            if (shouldProxy && proxyPort) {
              let proxyUrl = `http://127.0.0.1:${proxyPort}/playlist.m3u8?url=${encodeURIComponent(url)}`;
              if (referer) {
                proxyUrl += `&referer=${encodeURIComponent(referer)}`;
              }
              if (ua) {
                proxyUrl += `&ua=${encodeURIComponent(ua)}`;
              }
              proxyUrl += `&_t=${Date.now()}`;
              finalUrl = proxyUrl;
              isProxied = true;
            }
          } catch (e) {
            console.error("Failed to get proxy port:", e);
          }
        }

        if (isProxied) {
          await setProperty("http-header-fields", "").catch(() => {});
          await setProperty("referrer", "").catch(() => {});
          await setProperty(
            "user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          ).catch(() => {});
        } else {
          await setProperty(
            "user-agent",
            ua ||
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          ).catch(console.error);
          if (referer) {
            await setProperty("referrer", referer).catch(console.error);
          } else {
            await setProperty("referrer", "").catch(console.error);
          }
        }
        console.log(
          "[MPV loadFile] finalUrl:",
          finalUrl,
          "proxied:",
          isProxied,
          "torrent:",
          isTorrent,
        );

        if (isTorrent) {
          await setProperty("cache", "yes").catch(() => {});
          await setProperty("cache-pause-wait", 5).catch(() => {});
          await setProperty("cache-secs", 120).catch(() => {});
          await setProperty("demuxer-max-bytes", "150MiB").catch(() => {});
          await setProperty("demuxer-readahead-secs", 60).catch(() => {});
          await setProperty(
            "stream-lavf-o",
            "reconnect=1,reconnect_streamed=1,reconnect_delay_max=5",
          ).catch(() => {});
        }

        await command("loadfile", [finalUrl, "replace"]);
      } catch (err: any) {
        if (err.name === "AbortError" || err.message === "Aborted") {
          console.log("[MPV loadFile] Aborted previous load");
          return;
        }
        if (String(err).includes("instance not found")) return;
        console.error("Failed to load file:", err);
        setIsBuffering(false);
      }
    },
    [isInitialized],
  );

  const togglePause = useCallback(async () => {
    if (!isInitialized) return;
    try {
      await command("cycle", ["pause"]);
    } catch (err: any) {
      if (String(err).includes("instance not found")) return;
      console.error("Failed to toggle pause:", err);
    }
  }, [isInitialized]);

  const seek = useCallback(
    async (timeSeconds: number, mode: "absolute" | "relative" = "absolute") => {
      if (!isInitialized) return;
      try {
        await command("seek", [timeSeconds, mode]);
      } catch (err: any) {
        if (String(err).includes("instance not found")) return;
        console.error("Failed to seek:", err);
      }
    },
    [isInitialized],
  );

  const setVolumeLevel = useCallback(
    async (level: number) => {
      if (!isInitialized) return;
      try {
        const vol = Math.max(0, Math.min(150, level));
        await setProperty("volume", vol);
      } catch (err) {
        console.error("Failed to set volume:", err);
      }
    },
    [isInitialized],
  );

  const setPlaybackSpeed = useCallback(
    async (rate: number) => {
      if (!isInitialized) return;
      try {
        await setProperty("speed", rate);
      } catch (err) {
        console.error("Failed to set speed:", err);
      }
    },
    [isInitialized],
  );

  const selectTrack = useCallback(
    async (type: "aid" | "sid" | "vid", id: number | "no" | "auto") => {
      if (!isInitialized) return;
      try {
        if (id === "no" || id === "auto") {
          await setProperty(type, id);
        } else {
          await setProperty(type, id.toString());
        }
        setTimeout(fetchTracks, 200);
      } catch (err) {
        console.error(`Failed to set ${type}:`, err);
      }
    },
    [isInitialized, fetchTracks],
  );

  const addSubtitleFile = useCallback(
    async (url: string, title?: string) => {
      if (!isInitialized) return;
      try {
        await command("sub-add", [url, "auto", title || "External"]);
        setTimeout(fetchTracks, 1000);
      } catch (err) {
        console.error("Failed to add subtitle:", err);
      }
    },
    [isInitialized, fetchTracks],
  );

  const updateSubtitleSettings = useCallback(async () => {
    if (!isInitialized) return;
    try {
      const size = settingsStorage.getSubtitleFontSize() || 36;
      const margin = settingsStorage.getSubtitleBottomPadding() || 36;
      const outlineSize = settingsStorage.getSubtitleOutlineSize() ?? 2;
      const weight = settingsStorage.getSubtitleFontWeight() ?? 400;
      const baseFontFamily =
        settingsStorage.getSubtitleFontFamily() || "sans-serif";

      let fontName = baseFontFamily;
      let isBold = "no";

      // If the user selected the default sans-serif or Segoe UI, we can use specific Segoe UI variants
      // to achieve accurate font weights on Windows.
      if (baseFontFamily === "sans-serif" || baseFontFamily === "Segoe UI") {
        if (weight <= 300) {
          fontName = "Segoe UI Light";
        } else if (weight === 600) {
          fontName = "Segoe UI Semibold";
        } else if (weight === 700) {
          isBold = "yes";
        } else if (weight >= 800) {
          fontName = "Segoe UI Black";
        } else {
          fontName = baseFontFamily;
        }
      } else {
        // For other custom fonts, just rely on native bolding if weight >= 600
        if (weight >= 600) isBold = "yes";
      }

      await setProperty("sub-font", fontName).catch(() => {});
      await setProperty("sub-bold", isBold).catch(() => {});
      await setProperty("sub-font-size", size.toString()).catch(() => {});
      await setProperty("sub-margin-y", margin.toString()).catch(() => {});
      await setProperty("sub-ass-override", "force").catch(() => {});
      await setProperty("sub-color", "#FFFFFFFF").catch(() => {});
      await setProperty("sub-border-size", outlineSize.toString()).catch(
        () => {},
      );
      await setProperty("sub-shadow-offset", "1").catch(() => {});
      await setProperty("sub-border-color", "#FF000000").catch(() => {});
      await setProperty("sub-border-style", "outline-and-shadow").catch(
        () => {},
      );

      // Clear out background color properties just in case
      await setProperty("sub-back-color", "#00000000").catch(() => {});
      await setProperty("sub-bg-color", "#00000000").catch(() => {});
    } catch (err) {
      console.error("Failed to update subtitle settings:", err);
    }
  }, [isInitialized]);

  useEffect(() => {
    return () => {
      unlistenPropsRef.current?.();
      unlistenEventsRef.current?.();
    };
  }, []);

  const audioTracks = tracks.filter((t) => t.type === "audio");
  const subtitleTracks = tracks.filter((t) => t.type === "sub");
  const videoTracks = tracks.filter((t) => t.type === "video");

  return {
    isInitialized,
    initializationError,
    isPaused,
    currentTime,
    duration,
    volume,
    speed,
    isBuffering,
    cacheDuration,
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
    setProperty: async (prop: string, val: any) => {
      if (isInitialized) {
        try {
          await setProperty(prop, val);
        } catch (e) {}
      }
    },
  };
};

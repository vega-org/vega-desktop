import React, { useEffect, useMemo, useState, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { resume } from "@noriginmedia/norigin-spatial-navigation-core";
import { LuArrowDownNarrowWide, LuArrowDownWideNarrow, LuArrowLeft, LuCircleAlert, LuRefreshCw, LuSearch, LuX } from "react-icons/lu";
import { ContentDetailSkeleton } from "../components/content/ContentDetailSkeleton";
import { ContentHero } from "../components/content/ContentHero";
import { ContentOverview } from "../components/content/ContentOverview";
import { EpisodeDetailsDialog, type EpisodeDetails } from "../components/content/EpisodeDetailsDialog";
import { EpisodeRow } from "../components/content/EpisodeRow";
import { InfoStoryDialog } from "../components/content/InfoStoryDialog";
import { ResumeButton, type ResumeTarget } from "../components/content/ResumeButton";
import { LibraryCollectionDialog } from "../components/library/LibraryCollectionDialog";
import { SeasonSelector } from "../components/content/SeasonSelector";
import { DownloadServerDialog } from "../components/DownloadServerDialog";
import { FocusableButton } from "../components/layout/FocusableButton";
import { Skeleton } from "../components/ui/skeleton";
import { useArtworkPalette, useArtworkPaletteReady } from "../lib/hooks/useArtworkPalette";
import { useContentDetails } from "../lib/hooks/useContentInfo";
import { useEpisodes } from "../lib/hooks/useEpisodes";
import { useImageIsPortrait } from "../lib/hooks/useImageIsPortrait";
import type { EpisodeLink, Link, Stream, SkipInterval } from "../lib/providers/types";
import { providerManager } from "../lib/services/ProviderManager";
import { cacheStorage, type WatchHistoryItem } from "../lib/storage";
import { settingsStorage } from "../lib/storage/SettingsStorage";
import useContentStore from "../lib/zustand/contentStore";
import { useDownloadStore, isVideoDownloadItem, isSubtitleDownloadItem } from "../lib/zustand/downloadStore";
import useWatchHistoryStore from "../lib/zustand/watchHistrory";
import useWatchListStore from "../lib/zustand/watchListStore";
import "./MetaPage.css";

const EPISODE_SORT_ORDER_KEY_PREFIX = "episodeSortOrder";
/** Watched fraction past which the Resume button moves on to the next episode. */
const WATCHED_FRACTION = 0.85;

type EpisodeIdentity = { id?: string; sourceLink?: string; link?: string };

// Downloads play from a file path; sourceLink then holds the provider link.
const episodeKeys = (episode?: EpisodeIdentity) =>
  [episode?.id, episode?.sourceLink, episode?.link].filter((key): key is string => Boolean(key));

const findEpisodeIndex = (rows: EpisodeIdentity[], episode?: EpisodeIdentity) => {
  const keys = episodeKeys(episode);
  return rows.findIndex((row) => episodeKeys(row).some((key) => keys.includes(key)));
};

const seasonRows = (season: Link | null, episodeList: EpisodeLink[] | undefined, fallbackType?: string) => ({
  rows: (season?.episodesLink ? episodeList || [] : season?.directLinks || []) as EpisodeLink[],
  type: season?.episodesLink ? "series" : season?.directLinks?.[0]?.type || fallbackType || "movie",
});

/** Watched position of an episode: its history entry, else the player's saved progress. */
const readWatched = (entry: WatchHistoryItem, episode: EpisodeIdentity) => {
  if (entry.duration && entry.duration > 0) {
    return { position: entry.progress ?? entry.currentTime ?? 0, duration: entry.duration };
  }
  for (const key of episodeKeys(episode)) {
    try {
      const stored = JSON.parse(cacheStorage.getString(key) || "null");
      if (stored?.duration > 0) return { position: stored.position || 0, duration: stored.duration };
    } catch { /* Ignore invalid legacy progress. */ }
  }
  return { position: 0, duration: 0 };
};

interface DialogContext {
  id: string;
  title: string;
  poster: string;
  background?: string;
  synopsis?: string;
  showName?: string;
  episodeName?: string;
  seasonTitle?: string;
  episodeIndex?: number;
  type: "movie" | "series";
  imdbId?: string;
  sourceLink: string;
  downloaded?: boolean;
  downloadedServer?: string;
  downloadId?: string;
  skip?: SkipInterval[];
}

interface EpisodeSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  tvMode: boolean;
}

const EpisodeSearchField: React.FC<EpisodeSearchFieldProps> = ({
  value,
  onChange,
  tvMode,
}) => {
  const [isTyping, setIsTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { ref, focused, focusSelf } = useFocusable({
    focusable: tvMode,
    focusKey: "EPISODE_SEARCH_INPUT",
    onEnterPress: () => {
      setIsTyping(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    },
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  const stopTyping = () => {
    setIsTyping(false);
    window.setTimeout(() => {
      resume();
      focusSelf();
    }, 0);
  };

  return (
    <div
      ref={ref as any}
      className={`episode-search-field ${tvMode && focused ? "tv-focus" : ""}`}
      onClick={() => {
        setIsTyping(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }}
    >
      <LuSearch size={17} />
      <input
        ref={inputRef}
        aria-label="Find episode"
        placeholder="Find episode"
        tabIndex={tvMode ? -1 : 0}
        readOnly={tvMode ? !isTyping : false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={stopTyping}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (
            e.key === "Escape" ||
            e.key === "ArrowDown" ||
            e.key === "ArrowUp"
          ) {
            e.preventDefault();
            inputRef.current?.blur();
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="episode-search-clear"
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear episode search"
        >
          <LuX size={18} />
        </button>
      )}
    </div>
  );
};

export const MetaPage: React.FC = () => {
  const { url } = useParams<{ url: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { provider, installedProviders } = useContentStore();
  const { addDownload, downloads, cancelDownload } = useDownloadStore();
  const watchList = useWatchListStore((state) => state.watchList);
  const setItemCollections = useWatchListStore((state) => state.setItemCollections);
  const removeItem = useWatchListStore((state) => state.removeItem);
  // Id of the only category, or undefined when there are none or several.
  const onlyCollectionId = useWatchListStore((state) =>
    state.collections.length === 1 ? state.collections[0].id : undefined,
  );
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const isAndroid = navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;
  const { ref: focusRef, focusKey } = useFocusable({ focusable: tvMode, trackChildren: true });

  const link = decodeURIComponent(url || "");
  const activeProviderValue = searchParams.get("provider") || provider?.value || "";
  const episodeSortOrderKey = `${EPISODE_SORT_ORDER_KEY_PREFIX}:${activeProviderValue}:${link}`;
  const { info, meta, isLoading, error, refetch } = useContentDetails(link, activeProviderValue);
  const [activeSeason, setActiveSeason] = useState<Link | null>(null);
  const [dialogStreams, setDialogStreams] = useState<Stream[]>([]);
  const [dialogEpisodeTitle, setDialogEpisodeTitle] = useState("");
  const [dialogContext, setDialogContext] = useState<DialogContext | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [isDialogLoading, setIsDialogLoading] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [episodesProgress, setEpisodesProgress] = useState<Record<string, { position: number; duration: number }>>({});
  const [episodeSearch, setEpisodeSearch] = useState("");
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set());
  const [selectingEpisodes, setSelectingEpisodes] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState("");
  const batchController = useRef<AbortController | null>(null);

  useEffect(() => {
    setSelectedEpisodes(new Set());
    setSelectingEpisodes(false);
    setBatchResult("");
    setBatchProgress(null);
    return () => {
      batchController.current?.abort();
      batchController.current = null;
    };
  }, [link, activeProviderValue, activeSeason?.title, activeSeason?.episodesLink]);

  useEffect(() => {
    if (!selectingEpisodes) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (batchController.current) batchController.current.abort();
      else {
        setSelectingEpisodes(false);
        setSelectedEpisodes(new Set());
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectingEpisodes]);

  const [episodeDetails, setEpisodeDetails] = useState<EpisodeDetails | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() =>
    localStorage.getItem(episodeSortOrderKey) === "desc" ? "desc" : "asc",
  );

  const excludedQualities = useMemo(() => settingsStorage.getExcludedQualities(), []);
  const filteredLinkList = useMemo(() => {
    if (!info?.linkList) return [];
    if (!excludedQualities.length) return info.linkList;
    const filtered = info.linkList.filter((item: Link) =>
      !excludedQualities.some((quality) => item.title.toLowerCase().includes(quality.toLowerCase())),
    );
    return filtered.length ? filtered : info.linkList;
  }, [info?.linkList, excludedQualities]);

  useEffect(() => {
    document.querySelector<HTMLElement>(".layout-content")?.scrollTo(0, 0);
  }, [link]);

  useEffect(() => {
    setSortOrder(
      localStorage.getItem(episodeSortOrderKey) === "desc" ? "desc" : "asc",
    );
  }, [episodeSortOrderKey]);

  useEffect(() => {
    if (!filteredLinkList.length) {
      setActiveSeason(null);
      return;
    }
    const currentStillExists = activeSeason && filteredLinkList.some((item: Link) => item.title === activeSeason.title);
    if (currentStillExists) return;
    const savedTitle = localStorage.getItem(`vega_season_${link}`);
    setActiveSeason(filteredLinkList.find((item: Link) => item.title === savedTitle) ?? filteredLinkList[0]);
  }, [filteredLinkList, activeSeason, link]);

  const { data: episodeList, isLoading: episodeLoading, error: episodeError } = useEpisodes(
    activeSeason?.episodesLink,
    activeProviderValue,
    !!activeSeason?.episodesLink,
  );

  const cachedPosterImage = searchParams.get("poster") || "";
  const cachedBgImage = searchParams.get("background") || searchParams.get("bg") || "";
  const bgImage = meta?.background || info?.image || cachedBgImage;
  const isPortrait = useImageIsPortrait(bgImage);
  const posterImage = info?.poster || meta?.poster || cachedPosterImage || info?.image;
  const title = meta?.name || info?.title || "Untitled";
  const description = meta?.description || info?.synopsis || info?.description;
  const year = meta?.year || info?.year;
  const webUrl = info?.webUrl?.trim();
  const trailerUrl = info?.trailerUrl?.trim();
  const dynamicThemeEnabled = settingsStorage.isInfoPageDynamicThemeEnabled();
  const paletteArtwork = dynamicThemeEnabled
    ? bgImage || meta?.poster || cachedPosterImage || info?.image
    : null;
  const paletteStyle = useArtworkPalette(paletteArtwork);
  const paletteReady = useArtworkPaletteReady(paletteArtwork);
  const providerName =
    installedProviders.find((item) => item.value === activeProviderValue)?.display_name ||
    provider?.display_name ||
    activeProviderValue;

  useEffect(() => {
    const secondaryTitle = activeSeason?.title || "";
    const progressMap: Record<string, { position: number; duration: number }> = {};
    const readEpisodeProgress = (episode: EpisodeLink, index: number) => {
      const keys = [
        episode.id,
        episode.sourceLink,
        episode.link,
        `resume_${title}_${secondaryTitle}_${index}`,
      ].filter((key): key is string => Boolean(key));
      return keys.map((key) => cacheStorage.getString(key)).find(Boolean);
    };
    episodeList?.forEach((episode, index) => {
      const stored = readEpisodeProgress(episode, index);
      if (stored) {
        try { progressMap[index] = JSON.parse(stored); } catch { /* Ignore invalid legacy progress. */ }
      }
    });
    activeSeason?.directLinks?.forEach((episode, index) => {
      const stored = readEpisodeProgress(episode, index);
      if (stored) {
        try { progressMap[`direct_${index}`] = JSON.parse(stored); } catch { /* Ignore invalid legacy progress. */ }
      }
    });
    setEpisodesProgress(progressMap);
  }, [episodeList, activeSeason, title]);

  // Newest history entry for this title. History syncs between devices, so
  // episodes played in the mobile app count too.
  const watchHistory = useWatchHistoryStore((state) => state.history);
  const lastWatched = useMemo(
    () =>
      watchHistory
        .filter(
          (item) =>
            item.link === link &&
            item.episode &&
            (!item.provider || item.provider === activeProviderValue),
        )
        .reduce<WatchHistoryItem | undefined>((latest, item) => {
          const time = item.timestamp || item.lastPlayed || 0;
          return !latest || time > (latest.timestamp || latest.lastPlayed || 0) ? item : latest;
        }, undefined),
    [watchHistory, link, activeProviderValue],
  );
  const [pendingResume, setPendingResume] = useState<{ season: string; episode: EpisodeIdentity } | null>(null);

  const play = (items: Array<{ title: string; link: string }>, index: number, type: string) => {
    navigate("/player", {
      state: {
        episodeList: items,
        linkIndex: index,
        primaryTitle: title,
        secondaryTitle: activeSeason?.title || "",
        type,
        poster: { poster: posterImage, logo: meta?.logo || info?.logo, background: bgImage },
        providerValue: activeProviderValue,
        infoUrl: link,
      },
    });
  };

  // After switching season for a resume, play once its episodes arrive.
  useEffect(() => {
    if (!pendingResume || !lastWatched || activeSeason?.title !== pendingResume.season) return;
    if (activeSeason.episodesLink && episodeLoading) return;
    setPendingResume(null);
    const { rows: seasonItems, type } = seasonRows(activeSeason, episodeList, info?.type);
    const index = findEpisodeIndex(seasonItems, pendingResume.episode);
    if (index < 0) return;
    const { position, duration } = readWatched(lastWatched, pendingResume.episode);
    const watched = duration > 0 && position / duration > WATCHED_FRACTION;
    play(seasonItems, watched && seasonItems[index + 1] ? index + 1 : index, type);
  }, [pendingResume, activeSeason, episodeList, episodeLoading]);

  const dialogDownloadedSubtitles = useMemo(() => {
    if (!dialogContext) return [];
    return Object.values(downloads)
      .filter(
        (item) =>
          item.status === "completed" &&
          (item.id.startsWith(`${dialogContext.id}_subtitle_`) ||
            (item.infoUrl === link &&
              item.sourceLink === dialogContext.sourceLink &&
              item.id.includes("_subtitle_"))),
      )
      .map((s) => {
        let subTitle = s.title;
        if (s.id.includes("_subtitle_")) {
          const parts = s.id.split("_subtitle_");
          if (parts[1]) subTitle = parts[1];
        }
        return {
          id: s.id,
          title: subTitle,
          language: s.title,
          filePath: s.filePath,
        };
      });
  }, [downloads, dialogContext, link]);

  const isThemeLoading = dynamicThemeEnabled && (isLoading || !paletteReady);
  if ((isLoading && !info) || isThemeLoading) {
    return <ContentDetailSkeleton />;
  }

  if (error || !info) {
    return (
      <main className="content-detail-state">
        <span className="content-state-icon"><LuCircleAlert size={30} /></span>
        <h1>Could not load details</h1>
        <p>{error instanceof Error ? error.message : "Content was not found."}</p>
        <div className="content-state-actions">
          <FocusableButton className="content-secondary-button" onClick={() => navigate(-1)}><LuArrowLeft size={18} /> Go back</FocusableButton>
          <FocusableButton className="content-primary-button" onClick={() => void refetch()}><LuRefreshCw size={18} /> Retry</FocusableButton>
        </div>
      </main>
    );
  }

  const isInWatchList = watchList.some((item) => item.link === link);
  const toggleWatchList = () => {
    // With one category, save to it or remove directly. With none or several,
    // ask where to save.
    if (!onlyCollectionId) setCollectionPickerOpen(true);
    else if (isInWatchList) removeItem(link);
    else
      setItemCollections({ title, poster: posterImage, link, provider: activeProviderValue }, [
        onlyCollectionId,
      ]);
  };

  const prepareDownload = async (
    episode: { title: string; link: string },
    index: number,
    type: string,
    groupTitle: string,
    exactId?: string,
    isLongPress = false,
  ) => {
    const id = exactId || `${title}_S${groupTitle}_E${index + 1}`;
    const stored =
      (downloads[id] && isVideoDownloadItem(downloads[id])
        ? downloads[id]
        : null) ||
      Object.values(downloads).find(
        (item) =>
          isVideoDownloadItem(item) &&
          item.infoUrl === link &&
          item.sourceLink === episode.link,
      );
    const finalTitle = `${title} S${groupTitle} E${index + 1}`;
    const newContext: DialogContext = {
      id,
      title: finalTitle,
      poster: posterImage,
      background: bgImage,
      synopsis: description,
      showName: title,
      episodeName: episode.title,
      seasonTitle: groupTitle,
      episodeIndex: index,
      type: type as "movie" | "series",
      imdbId: info.imdbId || meta?.imdbId,
      sourceLink: episode.link,
      downloaded: stored?.status === "completed",
      downloadedServer: stored?.server,
      downloadId: stored?.id || id,
      skip:
        (episode as any)?.skip ||
        (episode as any)?.skips ||
        (activeSeason as any)?.skip ||
        (activeSeason as any)?.skips,
    };

    setDialogEpisodeTitle(finalTitle);
    setDialogContext(newContext);
    setDialogStreams([]);
    setDialogError(null);

    const isQuickDownload =
      Boolean(
        info.quickDownload ||
          activeSeason?.quickDownload ||
          (episode as any)?.quickDownload,
      ) &&
      !isLongPress &&
      stored?.status !== "completed";

    if (!isQuickDownload) {
      setIsDownloadDialogOpen(true);
    }

    setIsDialogLoading(true);
    setExtractingId(id);
    try {
      const streams = await providerManager.getStream({
        link: episode.link,
        type,
        signal: new AbortController().signal,
        providerValue: activeProviderValue,
        isDownload: true,
      });
      const validStreams = streams || [];
      setDialogStreams(validStreams);
      if (validStreams.length === 0) {
        setDialogError("No downloadable streams found.");
        if (isQuickDownload) {
          setIsDownloadDialogOpen(true);
        }
      } else if (isQuickDownload) {
        await executeQuickDownload(newContext, validStreams[0]);
        setIsDownloadDialogOpen(false);
        setDialogStreams([]);
        setDialogContext(null);
        setDialogError(null);
      }
    } catch (caughtError) {
      console.error("Failed to extract stream for download", caughtError);
      setDialogStreams([]);
      setDialogError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to extract stream for download.",
      );
      if (isQuickDownload) {
        setIsDownloadDialogOpen(true);
      }
    } finally {
      setIsDialogLoading(false);
      setExtractingId(null);
    }
  };

  const executeDownloadVideo = async (targetContext: DialogContext, stream: Stream) => {
    const resolvedSkip =
      stream.skip && stream.skip.length > 0
        ? stream.skip
        : (stream as any)?.skips && (stream as any).skips.length > 0
          ? (stream as any).skips
          : targetContext.skip;

    await addDownload({
      id: targetContext.id,
      title: targetContext.title,
      url: stream.link,
      server: stream.server,
      poster: targetContext.poster,
      background: targetContext.background,
      synopsis: targetContext.synopsis,
      provider: activeProviderValue || "unknown",
      infoUrl: link,
      sourceLink: targetContext.sourceLink,
      showName: targetContext.showName,
      episodeName: targetContext.episodeName,
      seasonTitle: targetContext.seasonTitle,
      episodeIndex: targetContext.episodeIndex,
      type: targetContext.type,
      imdbId: targetContext.imdbId,
      headers: stream.headers,
      skip: resolvedSkip,
      videoType: stream.type === "m3u8" || stream.link.includes(".m3u8") ? "m3u8" : stream.type,
    });
  };

  const executeQuickDownload = async (targetContext: DialogContext, stream: Stream, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    await executeDownloadVideo(targetContext, stream);

    if (!signal?.aborted && stream.subtitles && stream.subtitles.length > 0) {
      const sub = stream.subtitles[0];
      const subId = `${targetContext.id}_subtitle_${sub.title}`;
      await addDownload({
        id: subId,
        title: `${targetContext.title} ${sub.title} Subtitle`,
        url: sub.uri,
        server: "Subtitle",
        poster: targetContext.poster,
        background: targetContext.background,
        synopsis: targetContext.synopsis,
        provider: activeProviderValue || "unknown",
        infoUrl: link,
        sourceLink: targetContext.sourceLink,
        showName: targetContext.showName,
        episodeName: targetContext.episodeName,
        seasonTitle: targetContext.seasonTitle,
        episodeIndex: targetContext.episodeIndex,
        type: targetContext.type,
        imdbId: targetContext.imdbId,
        isSubtitle: true,
        videoType: sub.type?.includes("vtt") || sub.uri.includes(".vtt") ? "vtt" : "srt",
      });
    }
  };

  const selectStream = async (stream: Stream) => {
    if (!dialogContext) return;
    await executeDownloadVideo(dialogContext, stream);
    setIsDownloadDialogOpen(false);
    setDialogStreams([]);
    setDialogContext(null);
    setDialogError(null);
  };

  const selectSubtitle = async (sub: { uri: string; title: string; language?: string; type?: string }) => {
    if (!dialogContext) return;
    const subId = `${dialogContext.id}_subtitle_${sub.title}`;
    await addDownload({
      id: subId,
      title: `${dialogContext.title} ${sub.title} Subtitle`,
      url: sub.uri,
      server: "Subtitle",
      poster: dialogContext.poster,
      background: dialogContext.background,
      synopsis: dialogContext.synopsis,
      provider: activeProviderValue || "unknown",
      infoUrl: link,
      sourceLink: dialogContext.sourceLink,
      showName: dialogContext.showName,
      episodeName: dialogContext.episodeName,
      seasonTitle: dialogContext.seasonTitle,
      type: dialogContext.type,
      imdbId: dialogContext.imdbId,
      isSubtitle: true,
      videoType: sub.type?.includes("vtt") || sub.uri.includes(".vtt") ? "vtt" : "srt",
    });
    setIsDownloadDialogOpen(false);
    setDialogStreams([]);
    setDialogContext(null);
    setDialogError(null);
  };

  const { rows, type: rowType } = seasonRows(activeSeason, episodeList, info.type);
  const displayedRows = rows
    .map((episode: any, sourceIndex: number) => ({ episode, sourceIndex }))
    .filter(({ episode }) =>
      !episodeSearch.trim() || episode.title?.toLowerCase().includes(episodeSearch.trim().toLowerCase()),
    );
  if (sortOrder === "desc") displayedRows.reverse();
  const playableRows = displayedRows.map(({ episode }) => episode);
  const runSelectedEpisodes = async (action: "copy" | "download") => {
    if (batchController.current || !selectedEpisodes.size) return;
    const controller = new AbortController();
    batchController.current = controller;
    setBatchResult("");
    const selected = rows.map((episode, sourceIndex) => ({ episode, sourceIndex }))
      .filter(({ episode }) => selectedEpisodes.has(episode.link));
    const links: string[] = [];
    let processed = 0;
    let skipped = 0;
    try {
      for (const [index, { episode, sourceIndex }] of selected.entries()) {
        if (controller.signal.aborted) break;
        setBatchProgress(`${action === "copy" ? "Finding links" : "Starting downloads"} ${index + 1}/${selected.length}`);
        try {
          const groupTitle = activeSeason?.title || "Default";
          const id = `${title}_S${groupTitle}_E${sourceIndex + 1}`;
          if (action === "download" && Object.values(useDownloadStore.getState().downloads).some(
            (item) => isVideoDownloadItem(item) && item.status !== "error" &&
              (item.id === id || (item.infoUrl === link && item.sourceLink === episode.link)),
          )) {
            skipped++;
            continue;
          }
          const streams = await providerManager.getStream({
            link: episode.link, type: rowType, signal: controller.signal,
            providerValue: activeProviderValue, isDownload: true,
          });
          if (controller.signal.aborted) break;
          const stream = streams?.find((item) => /^https?:\/\//i.test(item.link));
          if (!stream) { skipped++; continue; }
          if (action === "copy") links.push(stream.link);
          else await executeQuickDownload({
            id, title: `${title} S${groupTitle} E${sourceIndex + 1}`,
            poster: posterImage, background: bgImage, synopsis: description,
            showName: title, episodeName: episode.title, seasonTitle: groupTitle,
            episodeIndex: sourceIndex, type: rowType as "movie" | "series",
            imdbId: info.imdbId || meta?.imdbId, sourceLink: episode.link,
            skip: (episode as any).skip || (episode as any).skips ||
              (activeSeason as any)?.skip || (activeSeason as any)?.skips,
          }, stream, controller.signal);
          processed++;
        } catch (error) {
          if (controller.signal.aborted) break;
          console.warn("Failed to process selected episode", episode.link, error);
          skipped++;
        }
      }
      if (action === "copy" && links.length && !controller.signal.aborted) {
        await navigator.clipboard.writeText(links.join("\n"));
      }
      if (batchController.current === controller) {
        setBatchResult(controller.signal.aborted ? (action === "download" ? "Cancelled. Downloads already queued will continue." : "Copy cancelled.") :
          `${processed} ${action === "copy" ? "links copied" : "downloads queued"}${skipped ? `, ${skipped} skipped` : ""}.`);
      }
    } catch (error) {
      if (batchController.current === controller) setBatchResult(error instanceof Error ? error.message : "Could not copy links.");
    } finally {
      if (batchController.current === controller) {
        batchController.current = null;
        setBatchProgress(null);
      }
    }
  };

  const showEpisodeSearch = rows.length > 8 || Boolean(episodeSearch);
  const showEpisodeSort = rows.length > 1;

  // Same targets as the mobile app: resume the last episode, move on to the
  // next one once it is mostly watched, or start from the first.
  const lastSeason =
    lastWatched?.seasonTitle && lastWatched.seasonTitle !== activeSeason?.title
      ? filteredLinkList.find((season: Link) => season.title === lastWatched.seasonTitle)
      : undefined;
  let resumeTarget: (ResumeTarget & { index?: number }) | null = null;
  if (lastWatched?.episode && lastSeason) {
    resumeTarget = {
      mode: "resume",
      seasonTitle: lastSeason.title,
      title: lastWatched.episode.title || lastWatched.episodeTitle || "Last episode",
    };
  } else {
    const index = lastWatched ? findEpisodeIndex(rows, lastWatched.episode) : -1;
    const episodeTitle = (i: number) => rows[i].title?.trim() || `Episode ${i + 1}`;
    if (lastWatched && index >= 0) {
      const { position, duration } = readWatched(lastWatched, rows[index]);
      const fraction = duration > 0 ? position / duration : 0;
      if (fraction <= WATCHED_FRACTION) {
        resumeTarget = {
          mode: "resume",
          title: episodeTitle(index),
          index,
          progress: fraction || undefined,
          remainingSeconds: duration > 0 ? duration - position : undefined,
        };
      } else if (rows[index + 1]) {
        resumeTarget = { mode: "next", title: episodeTitle(index + 1), index: index + 1 };
      }
    } else if (rows.length > 1) {
      resumeTarget = { mode: "start", title: episodeTitle(0), index: 0 };
    }
  }
  const handleResume = () => {
    if (lastSeason && lastWatched?.episode) {
      setPendingResume({ season: lastSeason.title, episode: lastWatched.episode });
      setActiveSeason(lastSeason);
      localStorage.setItem(`vega_season_${link}`, lastSeason.title);
      return;
    }
    if (resumeTarget?.index !== undefined) play(rows, resumeTarget.index, rowType);
  };
  const sortButton = showEpisodeSort ? (
    <FocusableButton
      className="episode-sort-button"
      focusKey="EPISODE_SORT_BUTTON"
      aria-label={sortOrder === "asc" ? "Sort episodes descending" : "Sort episodes ascending"}
      title={sortOrder === "asc" ? "Sort episodes descending" : "Sort episodes ascending"}
      onClick={() => {
        const nextOrder = sortOrder === "asc" ? "desc" : "asc";
        setSortOrder(nextOrder);
        localStorage.setItem(episodeSortOrderKey, nextOrder);
      }}
    >
      {sortOrder === "asc" ? (
        <LuArrowDownNarrowWide size={18} />
      ) : (
        <LuArrowDownWideNarrow size={18} />
      )}
    </FocusableButton>
  ) : null;
  const resumeButton = resumeTarget ? <ResumeButton target={resumeTarget} onPress={handleResume} /> : null;

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={focusRef} className="content-detail-page" style={paletteStyle}>
        <ContentHero
          title={title}
          background={bgImage}
          logo={meta?.logo || info.logo}
          year={year}
          runtime={meta?.runtime || info.runtime}
          rating={meta?.imdbRating || info.rating}
          genres={meta?.genre}
          tags={info.tags}
          onBack={() => navigate(-1)}
          isPortrait={isPortrait}
          overview={
            isPortrait ? (
              <ContentOverview
                description={description}
                providerName={providerName}
                isSaved={isInWatchList}
                onSearch={() => navigate(`/search?q=${encodeURIComponent(title)}`)}
                onToggleSaved={toggleWatchList}
                onOpenWeb={webUrl ? () => void openUrl(webUrl) : undefined}
                onOpenStory={info.tmdbId || info.imdbId ? () => setStoryOpen(true) : undefined}
                onOpenTrailer={trailerUrl ? () => void openUrl(trailerUrl) : undefined}
                primaryAction={resumeButton}
              />
            ) : undefined
          }
        />

        <div className="content-detail-inner">
          {!isPortrait && (
            <ContentOverview
              description={description}
              providerName={providerName}
              isSaved={isInWatchList}
              onSearch={() => navigate(`/search?q=${encodeURIComponent(title)}`)}
              onToggleSaved={toggleWatchList}
              onOpenWeb={webUrl ? () => void openUrl(webUrl) : undefined}
              onOpenStory={info.tmdbId || info.imdbId ? () => setStoryOpen(true) : undefined}
              onOpenTrailer={trailerUrl ? () => void openUrl(trailerUrl) : undefined}
              primaryAction={resumeButton}
            />
          )}

          <section className="content-episodes-section" aria-label="Available links">
            {/* Without the search field, the sort button sits beside the season picker. */}
            <div className="season-row">
              <SeasonSelector
                seasons={filteredLinkList}
                activeSeason={activeSeason}
                themeStyle={paletteStyle}
                onChange={(season) => {
                  setActiveSeason(season);
                  localStorage.setItem(`vega_season_${link}`, season.title);
                }}
              />
              {!showEpisodeSearch && sortButton}
            </div>

            {showEpisodeSearch && (
              <div className="episode-tools">
                <EpisodeSearchField
                  value={episodeSearch}
                  onChange={setEpisodeSearch}
                  tvMode={tvMode}
                />
                {sortButton}
              </div>
            )}

            {selectingEpisodes && (
              <div className="episode-selection-toolbar">
                <span>{selectedEpisodes.size} selected</span>
                <FocusableButton disabled={Boolean(batchProgress)} onClick={() => setSelectedEpisodes(new Set(displayedRows.map(({ episode }) => episode.link)))}>Select all</FocusableButton>
                <FocusableButton disabled={Boolean(batchProgress)} onClick={() => setSelectedEpisodes(new Set())}>Clear</FocusableButton>
                <FocusableButton disabled={Boolean(batchProgress) || !selectedEpisodes.size} onClick={() => void runSelectedEpisodes("copy")}>Copy links</FocusableButton>
                <FocusableButton disabled={Boolean(batchProgress) || !selectedEpisodes.size} onClick={() => void runSelectedEpisodes("download")}>Download</FocusableButton>
                {batchProgress ? <FocusableButton onClick={() => batchController.current?.abort()}>Cancel</FocusableButton> :
                  <FocusableButton onClick={() => { setSelectingEpisodes(false); setSelectedEpisodes(new Set()); setBatchResult(""); }}>Exit selection</FocusableButton>}
                <span role="status">{batchProgress || batchResult}</span>
              </div>
            )}

            {episodeLoading ? (
              <div className="content-skeleton-episode-grid" aria-label="Loading episodes">
                {Array.from({ length: 6 }, (_, index) => (
                  <div className="content-skeleton-episode-card" key={index}>
                    <Skeleton className="content-skeleton-thumbnail" />
                    <div className="content-skeleton-episode-copy">
                      <Skeleton />
                      <Skeleton />
                    </div>
                    <Skeleton className="content-skeleton-download" />
                  </div>
                ))}
              </div>
            ) : episodeError ? (
              <div className="episodes-inline-state error"><LuCircleAlert size={22} /><span>Episodes could not be loaded.</span></div>
            ) : displayedRows.length ? (
              <div className="content-episode-list">
                {displayedRows.map(({ episode, sourceIndex }, index) => {
                  const progressKey = activeSeason?.episodesLink ? String(sourceIndex) : `direct_${sourceIndex}`;
                  const progressData = episodesProgress[progressKey];
                  const progressPercent = progressData?.duration ? Math.min((progressData.position / progressData.duration) * 100, 100) : 0;
                  const groupTitle = activeSeason?.title || "Default";
                  const id = `${title}_S${groupTitle}_E${sourceIndex + 1}`;
                  const storedDownload =
                    (downloads[id] && isVideoDownloadItem(downloads[id])
                      ? downloads[id]
                      : null) ||
                    Object.values(downloads).find(
                      (item) =>
                        isVideoDownloadItem(item) &&
                        item.infoUrl === link &&
                        item.sourceLink === episode.link,
                    );
                  const hasDownloadedSubtitles = Object.values(downloads).some(
                    (item) =>
                      isSubtitleDownloadItem(item) &&
                      item.status === "completed" &&
                      (item.id.startsWith(`${id}_subtitle_`) ||
                        (item.infoUrl === link && item.sourceLink === episode.link)),
                  );
                  const storedDownloadId = storedDownload?.id || id;
                  const displayTitle =
                    episode.title?.trim() ||
                    (rows.length === 1
                      ? activeSeason?.title && activeSeason.title.toLowerCase() !== "default"
                        ? activeSeason.title
                        : "Play"
                      : `${activeSeason?.title || "Episode"} ${sourceIndex + 1}`);
                  return (
                    <EpisodeRow
                      key={`${episode.link}-${index}`}
                      index={index}
                      title={displayTitle}
                      description={episode.description}
                      image={episode.image}
                      progressPercent={progressPercent}
                      watched={progressPercent > 85}
                      download={storedDownload}
                      hasDownloadedSubtitles={hasDownloadedSubtitles}
                      extracting={extractingId === id}
                      selecting={selectingEpisodes}
                      selected={selectedEpisodes.has(episode.link)}
                      onPlay={(event) => {
                        if (selectingEpisodes || event?.ctrlKey || event?.metaKey) {
                          if (batchProgress) return;
                          setSelectingEpisodes(true);
                          setBatchResult("");
                          setSelectedEpisodes((previous) => {
                            const next = new Set(previous);
                            if (next.has(episode.link)) next.delete(episode.link);
                            else next.add(episode.link);
                            return next;
                          });
                        } else play(playableRows, index, rowType);
                      }}
                      onDownload={(e) => {
                        const isLongPress = Boolean(e?.ctrlKey || e?.metaKey);
                        void prepareDownload(episode, sourceIndex, rowType, groupTitle, id, isLongPress);
                      }}
                      onDeleteDownload={() => void cancelDownload(storedDownloadId)}
                      onShowDetails={episode.description?.trim() ? () => setEpisodeDetails({
                        title: episode.title || displayTitle,
                        description: episode.description.trim(),
                        image: episode.image,
                      }) : undefined}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="episodes-inline-state"><span>No playable links are available for this selection.</span></div>
            )}
          </section>
        </div>

        <DownloadServerDialog
          isOpen={isDownloadDialogOpen}
          onClose={() => {
            setIsDownloadDialogOpen(false);
            setDialogStreams([]);
            setDialogContext(null);
            setDialogError(null);
            setIsDialogLoading(false);
          }}
          streams={dialogStreams}
          loading={isDialogLoading}
          error={dialogError}
          onSelect={selectStream}
          episodeTitle={dialogEpisodeTitle}
          downloaded={dialogContext?.downloaded}
          downloadedServer={dialogContext?.downloadedServer}
          downloadedSubtitles={dialogDownloadedSubtitles}
          onSelectSubtitle={selectSubtitle}
          onDeleteSubtitle={(subId) => void cancelDownload(subId)}
          onDelete={() => {
            if (dialogContext?.downloadId) {
              void cancelDownload(dialogContext.downloadId);
              setIsDownloadDialogOpen(false);
              setDialogStreams([]);
              setDialogContext(null);
              setDialogError(null);
              setIsDialogLoading(false);
            }
          }}
        />
        <EpisodeDetailsDialog
          details={episodeDetails}
          onClose={() => setEpisodeDetails(null)}
        />
        <InfoStoryDialog
          open={storyOpen}
          onClose={() => setStoryOpen(false)}
          title={title}
          description={description}
          backdrop={bgImage}
          imdbId={info.imdbId}
          tmdbId={info.tmdbId}
          type={info.type}
        />
        <LibraryCollectionDialog
          open={collectionPickerOpen}
          onOpenChange={setCollectionPickerOpen}
          item={{ title, poster: posterImage, link, provider: activeProviderValue }}
          restoreFocusKey="CONTENT_WATCHLIST"
        />
      </main>
    </FocusContext.Provider>
  );
};

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
import { SeasonSelector } from "../components/content/SeasonSelector";
import { DownloadServerDialog } from "../components/DownloadServerDialog";
import { FocusableButton } from "../components/layout/FocusableButton";
import { Skeleton } from "../components/ui/skeleton";
import { useArtworkPalette, useArtworkPaletteReady } from "../lib/hooks/useArtworkPalette";
import { useContentDetails } from "../lib/hooks/useContentInfo";
import { useEpisodes } from "../lib/hooks/useEpisodes";
import type { EpisodeLink, Link, Stream, SkipInterval } from "../lib/providers/types";
import { providerManager } from "../lib/services/ProviderManager";
import { cacheStorage } from "../lib/storage";
import { settingsStorage } from "../lib/storage/SettingsStorage";
import useContentStore from "../lib/zustand/contentStore";
import { useDownloadStore, isVideoDownloadItem, isSubtitleDownloadItem } from "../lib/zustand/downloadStore";
import useWatchListStore from "../lib/zustand/watchListStore";
import "./MetaPage.css";

const EPISODE_SORT_ORDER_KEY_PREFIX = "episodeSortOrder";

interface DialogContext {
  id: string;
  title: string;
  poster: string;
  showName?: string;
  episodeName?: string;
  seasonTitle?: string;
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
      className={`episode-search-field ${focused ? "tv-focus" : ""}`}
      onClick={() => {
        setIsTyping(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }}
    >
      <LuSearch size={21} />
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
  const { watchList, addItem, removeItem } = useWatchListStore();
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
    if (isInWatchList) removeItem(link);
    else addItem({ title, poster: posterImage, link, provider: activeProviderValue });
  };

  const play = (items: Array<{ title: string; link: string }>, index: number, type: string) => {
    navigate("/player", {
      state: {
        episodeList: items,
        linkIndex: index,
        primaryTitle: title,
        secondaryTitle: activeSeason?.title || "",
        type,
        poster: { poster: posterImage, logo: meta?.logo || info.logo, background: bgImage },
        providerValue: activeProviderValue,
        infoUrl: link,
      },
    });
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
      showName: title,
      episodeName: episode.title,
      seasonTitle: groupTitle,
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
      provider: activeProviderValue || "unknown",
      infoUrl: link,
      sourceLink: targetContext.sourceLink,
      showName: targetContext.showName,
      episodeName: targetContext.episodeName,
      seasonTitle: targetContext.seasonTitle,
      type: targetContext.type,
      imdbId: targetContext.imdbId,
      headers: stream.headers,
      skip: resolvedSkip,
      videoType: stream.type === "m3u8" || stream.link.includes(".m3u8") ? "m3u8" : stream.type,
    });
  };

  const executeQuickDownload = async (targetContext: DialogContext, stream: Stream) => {
    await executeDownloadVideo(targetContext, stream);

    if (stream.subtitles && stream.subtitles.length > 0) {
      const sub = stream.subtitles[0];
      const subId = `${targetContext.id}_subtitle_${sub.title}`;
      await addDownload({
        id: subId,
        title: `${targetContext.title} ${sub.title} Subtitle`,
        url: sub.uri,
        server: "Subtitle",
        poster: targetContext.poster,
        provider: activeProviderValue || "unknown",
        infoUrl: link,
        sourceLink: targetContext.sourceLink,
        showName: targetContext.showName,
        episodeName: targetContext.episodeName,
        seasonTitle: targetContext.seasonTitle,
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

  const rows = activeSeason?.episodesLink ? episodeList || [] : activeSeason?.directLinks || [];
  const rowType = activeSeason?.episodesLink ? "series" : activeSeason?.directLinks?.[0]?.type || info.type || "movie";
  const displayedRows = rows
    .map((episode: any, sourceIndex: number) => ({ episode, sourceIndex }))
    .filter(({ episode }) =>
      !episodeSearch.trim() || episode.title?.toLowerCase().includes(episodeSearch.trim().toLowerCase()),
    );
  if (sortOrder === "desc") displayedRows.reverse();
  const playableRows = displayedRows.map(({ episode }) => episode);
  const showEpisodeSearch = rows.length > 8 || Boolean(episodeSearch);
  const showEpisodeSort = rows.length > 1;

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
        />

        <div className="content-detail-inner">
          <ContentOverview
            description={description}
            providerName={providerName}
            isSaved={isInWatchList}
            onSearch={() => navigate(`/search?q=${encodeURIComponent(title)}`)}
            onToggleSaved={toggleWatchList}
            onOpenWeb={webUrl ? () => void openUrl(webUrl) : undefined}
            onOpenStory={info.tmdbId || info.imdbId ? () => setStoryOpen(true) : undefined}
            onOpenTrailer={trailerUrl ? () => void openUrl(trailerUrl) : undefined}
          />

          <section className="content-episodes-section" aria-label="Available links">
            <div>
              <SeasonSelector
                seasons={filteredLinkList}
                activeSeason={activeSeason}
                themeStyle={paletteStyle}
                onChange={(season) => {
                  setActiveSeason(season);
                  localStorage.setItem(`vega_season_${link}`, season.title);
                }}
              />
            </div>

            {(showEpisodeSearch || showEpisodeSort) && (
              <div className="episode-tools">
                {showEpisodeSearch && (
                  <EpisodeSearchField
                    value={episodeSearch}
                    onChange={setEpisodeSearch}
                    tvMode={tvMode}
                  />
                )}
                {showEpisodeSort && (
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
                      <LuArrowDownNarrowWide size={22} />
                    ) : (
                      <LuArrowDownWideNarrow size={22} />
                    )}
                  </FocusableButton>
                )}
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
                  const displayTitle = !activeSeason?.episodesLink && rows.length === 1 ? "Play" : episode.title;
                  return (
                    <EpisodeRow
                      key={`${episode.link}-${index}`}
                      index={index}
                      title={displayTitle || `${activeSeason?.title || "Episode"} ${sourceIndex + 1}`}
                      description={episode.description}
                      image={episode.image}
                      progressPercent={progressPercent}
                      watched={progressPercent > 85}
                      download={storedDownload}
                      hasDownloadedSubtitles={hasDownloadedSubtitles}
                      extracting={extractingId === id}
                      onPlay={() => play(playableRows, index, rowType)}
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
      </main>
    </FocusContext.Provider>
  );
};

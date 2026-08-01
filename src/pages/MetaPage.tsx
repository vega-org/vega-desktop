import React, { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { LuArrowDownUp, LuArrowLeft, LuCircleAlert, LuRefreshCw, LuSearch } from "react-icons/lu";
import { ContentDetailSkeleton } from "../components/content/ContentDetailSkeleton";
import { ContentHero } from "../components/content/ContentHero";
import { ContentOverview } from "../components/content/ContentOverview";
import { EpisodeRow } from "../components/content/EpisodeRow";
import { InfoStoryDialog } from "../components/content/InfoStoryDialog";
import { SeasonSelector } from "../components/content/SeasonSelector";
import { DownloadServerDialog } from "../components/DownloadServerDialog";
import { FocusableButton } from "../components/layout/FocusableButton";
import { useArtworkPalette, useArtworkPaletteReady } from "../lib/hooks/useArtworkPalette";
import { useContentDetails } from "../lib/hooks/useContentInfo";
import { useEpisodes } from "../lib/hooks/useEpisodes";
import type { Link, Stream } from "../lib/providers/types";
import { providerManager } from "../lib/services/ProviderManager";
import { cacheStorage, mainStorage } from "../lib/storage";
import { settingsStorage } from "../lib/storage/SettingsStorage";
import useContentStore from "../lib/zustand/contentStore";
import { useDownloadStore } from "../lib/zustand/downloadStore";
import useWatchListStore from "../lib/zustand/watchListStore";
import "./MetaPage.css";

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
}

export const MetaPage: React.FC = () => {
  const { url } = useParams<{ url: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { provider, installedProviders } = useContentStore();
  const { addDownload, downloads, cancelDownload } = useDownloadStore();
  const { watchList, addItem, removeItem } = useWatchListStore();
  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref: focusRef, focusKey } = useFocusable({ focusable: tvMode, trackChildren: true });

  const link = decodeURIComponent(url || "");
  const activeProviderValue = searchParams.get("provider") || provider?.value || "";
  const { info, meta, isLoading, error, refetch } = useContentDetails(link, activeProviderValue);
  const [activeSeason, setActiveSeason] = useState<Link | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [dialogStreams, setDialogStreams] = useState<Stream[]>([]);
  const [dialogEpisodeTitle, setDialogEpisodeTitle] = useState("");
  const [dialogContext, setDialogContext] = useState<DialogContext | null>(null);
  const [episodesProgress, setEpisodesProgress] = useState<Record<string, { position: number; duration: number }>>({});
  const [episodeSearch, setEpisodeSearch] = useState("");
  const [storyOpen, setStoryOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() =>
    mainStorage.getString("episodeSortOrder") === "desc" ? "desc" : "asc",
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

  const bgImage = meta?.background || info?.background || info?.image;
  const cachedPosterImage = searchParams.get("poster") || "";
  const posterImage = meta?.poster || info?.poster || cachedPosterImage || info?.image;
  const title = meta?.name || info?.title || "Untitled";
  const description = meta?.description || info?.synopsis || info?.description;
  const year = meta?.year || info?.year;
  const webUrl = info?.webUrl?.trim();
  const trailerUrl = info?.trailerUrl?.trim();
  const dynamicThemeEnabled = settingsStorage.isInfoPageDynamicThemeEnabled();
  const paletteArtwork = dynamicThemeEnabled ? posterImage || bgImage : null;
  const paletteStyle = useArtworkPalette(paletteArtwork);
  const paletteReady = useArtworkPaletteReady(paletteArtwork);
  const providerName =
    installedProviders.find((item) => item.value === activeProviderValue)?.display_name ||
    provider?.display_name ||
    activeProviderValue;

  useEffect(() => {
    const secondaryTitle = activeSeason?.title || "";
    const progressMap: Record<string, { position: number; duration: number }> = {};
    episodeList?.forEach((_, index) => {
      const stored = cacheStorage.getString(`resume_${title}_${secondaryTitle}_${index}`);
      if (stored) {
        try { progressMap[index] = JSON.parse(stored); } catch { /* Ignore invalid legacy progress. */ }
      }
    });
    activeSeason?.directLinks?.forEach((_, index) => {
      const stored = cacheStorage.getString(`resume_${title}_${secondaryTitle}_${index}`);
      if (stored) {
        try { progressMap[`direct_${index}`] = JSON.parse(stored); } catch { /* Ignore invalid legacy progress. */ }
      }
    });
    setEpisodesProgress(progressMap);
  }, [episodeList, activeSeason, title]);

  if ((isLoading && !info) || (dynamicThemeEnabled && !paletteReady)) {
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
    seasonTitle?: string,
    exactId?: string,
  ) => {
    const id = exactId || (seasonTitle ? `${title}_S${seasonTitle}_E${index + 1}` : `${title}_direct_${index}`);
    try {
      setDownloadingId(id);
      const streams = await providerManager.getStream({
        link: episode.link,
        type,
        signal: new AbortController().signal,
        providerValue: activeProviderValue,
      });
      if (!streams?.length) return;
      const finalTitle = seasonTitle ? `${title} S${seasonTitle} E${index + 1}` : episode.title || title;
      setDialogStreams(streams);
      setDialogEpisodeTitle(finalTitle);
      setDialogContext({
        id,
        title: finalTitle,
        poster: posterImage,
        showName: title,
        episodeName: episode.title,
        seasonTitle,
        type: type as "movie" | "series",
        imdbId: info.imdbId || meta?.imdbId,
        sourceLink: episode.link,
      });
    } catch (caughtError) {
      console.error("Failed to extract stream for download", caughtError);
    } finally {
      setDownloadingId(null);
    }
  };

  const selectStream = async (stream: Stream) => {
    if (!dialogContext) return;
    await addDownload({
      id: dialogContext.id,
      title: dialogContext.title,
      url: stream.link,
      poster: dialogContext.poster,
      provider: activeProviderValue || "unknown",
      infoUrl: link,
      sourceLink: dialogContext.sourceLink,
      showName: dialogContext.showName,
      episodeName: dialogContext.episodeName,
      seasonTitle: dialogContext.seasonTitle,
      type: dialogContext.type,
      imdbId: dialogContext.imdbId,
      headers: stream.headers,
      subtitles: stream.subtitles?.map((subtitle: any) => ({
        url: subtitle.uri || subtitle.url,
        language: subtitle.language || "Unknown",
        format: subtitle.type?.includes("vtt") ? "vtt" : subtitle.type?.includes("subrip") ? "srt" : undefined,
      })),
      videoType: stream.type === "m3u8" || stream.link.includes(".m3u8") ? "m3u8" : stream.type,
    });
    setDialogStreams([]);
    setDialogContext(null);
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
  const showEpisodeTools = rows.length > 8 || Boolean(episodeSearch);

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

            {showEpisodeTools && (
              <div className="episode-tools">
                <label className="episode-search-field">
                  <LuSearch size={21} />
                  <input
                    aria-label="Find episode"
                    placeholder="Find episode"
                    value={episodeSearch}
                    onChange={(event) => setEpisodeSearch(event.target.value)}
                  />
                </label>
                <FocusableButton
                  className="episode-sort-button"
                  title={sortOrder === "asc" ? "Sort episodes descending" : "Sort episodes ascending"}
                  onClick={() => {
                    const nextOrder = sortOrder === "asc" ? "desc" : "asc";
                    setSortOrder(nextOrder);
                    mainStorage.setString("episodeSortOrder", nextOrder);
                  }}
                >
                  <LuArrowDownUp size={22} />
                </FocusableButton>
              </div>
            )}

            {episodeLoading ? (
              <div className="episode-skeleton-list" aria-label="Loading episodes">
                {Array.from({ length: 6 }, (_, index) => <span className="episode-skeleton-row" key={index} />)}
              </div>
            ) : episodeError ? (
              <div className="episodes-inline-state error"><LuCircleAlert size={22} /><span>Episodes could not be loaded.</span></div>
            ) : displayedRows.length ? (
              <div className="content-episode-list">
                {displayedRows.map(({ episode, sourceIndex }, index) => {
                  const progressKey = activeSeason?.episodesLink ? String(sourceIndex) : `direct_${sourceIndex}`;
                  const progressData = episodesProgress[progressKey];
                  const progressPercent = progressData?.duration ? Math.min((progressData.position / progressData.duration) * 100, 100) : 0;
                  const id = activeSeason?.episodesLink
                    ? `${title}_S${activeSeason.title}_E${sourceIndex + 1}`
                    : `${title}_direct_${sourceIndex}`;
                  const displayTitle = !activeSeason?.episodesLink && rows.length === 1 ? "Play" : episode.title;
                  return (
                    <EpisodeRow
                      key={`${episode.link}-${index}`}
                      index={index}
                      title={displayTitle || `${activeSeason?.title || "Episode"} ${sourceIndex + 1}`}
                      description={episode.description}
                      image={episode.image}
                      progressPercent={progressPercent}
                      watched={progressPercent > 80}
                      download={downloads[id]}
                      extracting={downloadingId === id}
                      onPlay={() => play(playableRows, index, rowType)}
                      onDownload={() => void prepareDownload(episode, sourceIndex, rowType, activeSeason?.episodesLink ? activeSeason.title : undefined, id)}
                      onDeleteDownload={() => void cancelDownload(id)}
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
          isOpen={dialogStreams.length > 0}
          onClose={() => { setDialogStreams([]); setDialogContext(null); }}
          streams={dialogStreams}
          onSelect={selectStream}
          episodeTitle={dialogEpisodeTitle}
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

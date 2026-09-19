import { useEffect, useMemo, useState } from "react";
import {
  LuArrowDownNarrowWide as ArrowDownNarrowWide,
  LuArrowDownWideNarrow as ArrowDownWideNarrow,
  LuArrowLeft as ArrowLeft,
  LuDownload as Download,
  LuSearch as Search,
  LuTrash2 as Trash2,
  LuX as X,
} from "react-icons/lu";
import { useNavigate, useParams } from "react-router-dom";
import { CustomSelect } from "../components/CustomSelect";
import { DownloadedVideoThumbnail } from "../components/DownloadedVideoThumbnail";
import { FocusableButton } from "../components/layout/FocusableButton";
import { sortDownloadedEpisodes } from "../lib/downloadLibrary";
import { getDownloadedVideoThumbnail } from "../lib/downloadThumbnailCache";
import {
  type DownloadItem,
  useDownloadStore,
} from "../lib/zustand/downloadStore";
import "./DownloadsPage.css";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${Number((bytes / 1024 ** unit).toFixed(1))} ${units[unit]}`;
};

export const DownloadsSeriesPage = () => {
  const { showName } = useParams<{ showName: string }>();
  const navigate = useNavigate();
  const { downloads, cancelDownload } = useDownloadStore();
  const decodedShowName = decodeURIComponent(showName || "");

  const showDownloads = useMemo(
    () =>
      Object.values(downloads).filter(
        (item) =>
          item.status === "completed" &&
          !item.isSubtitle &&
          !item.id.includes("_subtitle_") &&
          item.videoType !== "vtt" &&
          item.videoType !== "srt" &&
          (item.showName === decodedShowName || item.title === decodedShowName),
      ),
    [downloads, decodedShowName],
  );

  const seasons = useMemo(() => {
    const values = new Set<string>();
    showDownloads.forEach((item) => values.add(item.seasonTitle || "Extras"));
    return Array.from(values).sort();
  }, [showDownloads]);

  const [activeSeason, setActiveSeason] = useState("Extras");
  const [episodeSearch, setEpisodeSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (seasons.length && !seasons.includes(activeSeason)) {
      setActiveSeason(seasons[0]);
    }
  }, [activeSeason, seasons]);

  useEffect(() => {
    if (!showDownloads.length) {
      navigate("/downloads", { replace: true });
    }
  }, [navigate, showDownloads.length]);

  const poster = showDownloads[0]?.poster;
  const [extractedThumb, setExtractedThumb] = useState<string | null>(null);
  const firstVideoPath = showDownloads[0]?.filePath;

  useEffect(() => {
    if (!poster && firstVideoPath) {
      void getDownloadedVideoThumbnail(firstVideoPath).then((thumb) => {
        if (thumb) setExtractedThumb(thumb);
      });
    }
  }, [poster, firstVideoPath]);

  const displayPoster = poster || extractedThumb;

  const currentSeasonDownloads = useMemo(() => {
    let list = sortDownloadedEpisodes(
      showDownloads.filter(
        (item) => (item.seasonTitle || "Extras") === activeSeason,
      ),
    );
    if (episodeSearch.trim()) {
      const query = episodeSearch.trim().toLowerCase();
      list = list.filter((item) =>
        (item.episodeName || item.title || "").toLowerCase().includes(query),
      );
    }
    if (sortOrder === "desc") {
      list = [...list].reverse();
    }
    return list;
  }, [showDownloads, activeSeason, episodeSearch, sortOrder]);

  if (!showDownloads.length) return null;

  const handlePlay = (item: DownloadItem, index: number) => {
    const episodeList = currentSeasonDownloads.map((episode) => ({
      id: episode.id,
      title: episode.episodeName || episode.title,
      link: episode.filePath,
      localFile: true,
      sourceLink: episode.sourceLink,
      skip: episode.skip,
    }));

    navigate("/player", {
      state: {
        episodeList,
        linkIndex: index,
        type: item.type || "series",
        primaryTitle: item.showName || item.title,
        secondaryTitle: item.seasonTitle,
        poster: { poster: item.poster },
        providerValue: item.provider || "",
        infoUrl: item.infoUrl || item.filePath,
        doNotTrack: !item.infoUrl,
      },
    });
  };

  return (
    <main className="downloads-series-page">
      <header className="downloads-series-header">
        <FocusableButton
          className="downloads-series-back"
          onClick={() => navigate("/downloads")}
          title="Back to downloads"
        >
          <ArrowLeft size={22} />
        </FocusableButton>
        <div className="downloads-series-header-copy">
          <p className="downloads-eyebrow">Downloaded series</p>
          <h1>{decodedShowName}</h1>
          <p>
            {showDownloads.length} downloaded{" "}
            {showDownloads.length === 1 ? "episode" : "episodes"}
          </p>
        </div>
      </header>

      <div className="series-downloads-layout">
        <aside className="series-downloads-summary">
          <div
            className="series-downloads-poster"
            style={{ backgroundImage: displayPoster ? `url(${displayPoster})` : undefined }}
            aria-label={`${decodedShowName} poster`}
          >
            {!displayPoster && <Download size={38} />}
          </div>
          <div className="series-downloads-stats">
            <span>
              {seasons.length} {seasons.length === 1 ? "season" : "seasons"}
            </span>
            <span>
              {formatBytes(
                showDownloads.reduce(
                  (sum, item) => sum + (item.totalBytes || 0),
                  0,
                ),
              )}
            </span>
          </div>
        </aside>

        <section
          className="series-episodes-section"
          aria-labelledby="downloaded-episodes-title"
        >
          <div className="series-episodes-toolbar">
            <div>
              <p className="downloads-section-kicker">Ready offline</p>
              <h2 id="downloaded-episodes-title">Episodes</h2>
            </div>
            {seasons.length > 0 && (
              <CustomSelect
                options={seasons.map((season) => ({
                  value: season,
                  label: season,
                }))}
                value={activeSeason}
                onChange={setActiveSeason}
                className="season-selector-custom"
              />
            )}
            <div className="episode-tools">
              <div className="episode-search-field">
                <Search size={21} />
                <input
                  aria-label="Find episode"
                  placeholder="Find episode"
                  value={episodeSearch}
                  onChange={(e) => setEpisodeSearch(e.target.value)}
                />
                {episodeSearch && (
                  <button
                    type="button"
                    className="episode-search-clear"
                    onClick={() => setEpisodeSearch("")}
                    aria-label="Clear episode search"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              <FocusableButton
                className="episode-sort-button"
                aria-label={
                  sortOrder === "asc"
                    ? "Sort episodes descending"
                    : "Sort episodes ascending"
                }
                title={
                  sortOrder === "asc"
                    ? "Sort episodes descending"
                    : "Sort episodes ascending"
                }
                onClick={() =>
                  setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
                }
              >
                {sortOrder === "asc" ? (
                  <ArrowDownNarrowWide size={22} />
                ) : (
                  <ArrowDownWideNarrow size={22} />
                )}
              </FocusableButton>
            </div>
          </div>

          <div className="downloaded-episodes-list">
            {currentSeasonDownloads.length === 0 ? (
              <div className="downloaded-episodes-empty">
                <p>
                  No downloaded episodes found
                  {episodeSearch ? ` for "${episodeSearch}"` : ""}.
                </p>
              </div>
            ) : (
              currentSeasonDownloads.map((item, index) => (
                <article className="downloaded-episode-row" key={item.id}>
                  <FocusableButton
                    className="downloaded-episode-main"
                    onClick={() => handlePlay(item, index)}
                  >
                    <DownloadedVideoThumbnail
                      filePath={item.filePath}
                      title={item.episodeName || item.title}
                    />
                    <span className="downloaded-episode-copy">
                      <strong>{item.episodeName || item.title}</strong>
                      <small>{formatBytes(item.totalBytes)}</small>
                    </span>
                  </FocusableButton>
                  <div className="downloaded-episode-actions">
                    <FocusableButton
                      className="episode-download-action is-danger"
                      onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        void cancelDownload(item.id);
                      }}
                      title="Delete download"
                    >
                      <Trash2 size={18} />
                    </FocusableButton>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
};

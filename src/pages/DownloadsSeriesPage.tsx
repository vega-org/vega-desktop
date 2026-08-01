import { useEffect, useMemo, useState } from "react";
import {
  LuArrowLeft as ArrowLeft,
  LuDownload as Download,
  LuPlay as Play,
  LuTrash2 as Trash2,
} from "react-icons/lu";
import { useNavigate, useParams } from "react-router-dom";
import { CustomSelect } from "../components/CustomSelect";
import { FocusableButton } from "../components/layout/FocusableButton";
import { sortDownloadedEpisodes } from "../lib/downloadLibrary";
import {
  type DownloadItem,
  useDownloadStore,
} from "../lib/zustand/downloadStore";
import "./DownloadsPage.css";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
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

  if (!showDownloads.length) return null;

  const poster = showDownloads[0]?.poster;
  const currentSeasonDownloads = sortDownloadedEpisodes(
    showDownloads.filter((item) => (item.seasonTitle || "Extras") === activeSeason),
  );

  const handlePlay = (item: DownloadItem, index: number) => {
    const episodeList = currentSeasonDownloads.map((episode) => ({
      id: episode.id,
      title: episode.episodeName || episode.title,
      link: episode.filePath,
      localFile: true,
      sourceLink: episode.sourceLink,
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
          <p>{showDownloads.length} downloaded {showDownloads.length === 1 ? "episode" : "episodes"}</p>
        </div>
      </header>

      <div className="series-downloads-layout">
        <aside className="series-downloads-summary">
          <div
            className="series-downloads-poster"
            style={{ backgroundImage: poster ? `url(${poster})` : undefined }}
            aria-label={`${decodedShowName} poster`}
          >
            {!poster && <Download size={38} />}
          </div>
          <div className="series-downloads-stats">
            <span>{seasons.length} {seasons.length === 1 ? "season" : "seasons"}</span>
            <span>{formatBytes(showDownloads.reduce((sum, item) => sum + (item.totalBytes || 0), 0))}</span>
          </div>
        </aside>

        <section className="series-episodes-section" aria-labelledby="downloaded-episodes-title">
          <div className="series-episodes-toolbar">
            <div>
              <p className="downloads-section-kicker">Ready offline</p>
              <h2 id="downloaded-episodes-title">Episodes</h2>
            </div>
            {seasons.length > 1 && (
              <CustomSelect
                options={seasons.map((season) => ({ value: season, label: season }))}
                value={activeSeason}
                onChange={setActiveSeason}
                className="season-selector-custom"
              />
            )}
          </div>

          <div className="downloaded-episodes-list">
            {currentSeasonDownloads.map((item, index) => (
              <article className="downloaded-episode-row" key={item.id}>
                <FocusableButton className="downloaded-episode-main" onClick={() => handlePlay(item, index)}>
                  <span className="downloaded-episode-number">{index + 1}</span>
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
                  <FocusableButton
                    className="episode-download-action is-primary"
                    onClick={() => handlePlay(item, index)}
                    title="Play episode"
                  >
                    <Play size={18} fill="currentColor" />
                  </FocusableButton>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
};

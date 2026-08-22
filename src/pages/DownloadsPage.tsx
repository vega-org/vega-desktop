import React, { useEffect, useMemo } from "react";
import {
  LuCircleAlert as AlertCircle,
  LuClock3 as Clock,
  LuDownload as Download,
  LuHardDrive as HardDrive,
  LuPause as Pause,
  LuPlay as Play,
  LuRocket as Rocket,
  LuTrash2 as Trash2,
  LuX as X,
} from "react-icons/lu";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useNavigate } from "react-router-dom";
import { FocusableButton } from "../components/layout/FocusableButton";
import { settingsStorage } from "../lib/storage";
import {
  type DownloadItem,
  useDownloadStore,
} from "../lib/zustand/downloadStore";
import { syncFromSharedFolder } from "../lib/sync/syncService";
import "./DownloadsPage.css";

type CompletedGroup = {
  showName: string;
  poster: string;
  type: "movie" | "series";
  items: DownloadItem[];
  totalBytes: number;
};

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${Number((bytes / 1024 ** unit).toFixed(1))} ${units[unit]}`;
};

const getCleanTitle = (item: DownloadItem) => {
  if (item.type === "series") return item.episodeName || item.title;
  return item.showName || item.title || "Unknown video";
};

const statusCopy: Record<DownloadItem["status"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  paused: "Paused",
  completed: "Completed",
  error: "Failed",
};

export const DownloadsPage = () => {
  const { downloads, pauseDownload, resumeDownload, cancelDownload, startNow } =
    useDownloadStore();
  const navigate = useNavigate();
  const allDownloads = Object.values(downloads);

  useEffect(() => {
    syncFromSharedFolder().catch((err) =>
      console.warn("[VegaSync] Downloads page sync failed:", err),
    );
  }, []);

  const activeDownloads = useMemo(
    () =>
      allDownloads.filter((item) =>
        ["downloading", "queued", "paused", "error"].includes(item.status),
      ),
    [allDownloads],
  );

  const completedGroups = useMemo(() => {
    const groups: Record<string, CompletedGroup> = {};
    allDownloads
      .filter(
        (item) =>
          item.status === "completed" &&
          !item.isSubtitle &&
          !item.id.includes("_subtitle_") &&
          item.videoType !== "vtt" &&
          item.videoType !== "srt",
      )
      .forEach((item) => {
        const key = item.showName || item.title;
        groups[key] ??= {
          showName: key,
          poster: item.poster || "",
          type: item.type || "movie",
          items: [],
          totalBytes: 0,
        };
        groups[key].items.push(item);
        groups[key].totalBytes += item.totalBytes || 0;
      });
    return Object.values(groups);
  }, [allDownloads]);

  const handlePlay = (item: DownloadItem) => {
    navigate("/player", {
      state: {
        episodeList: [
          {
            id: item.id,
            title: item.title,
            link: item.filePath,
            localFile: true,
            sourceLink: item.sourceLink,
            skip: item.skip,
          },
        ],
        linkIndex: 0,
        type: "movie",
        primaryTitle: item.showName || item.title,
        poster: { poster: item.poster },
        providerValue: item.provider || "",
        infoUrl: item.infoUrl || item.filePath,
        doNotTrack: !item.infoUrl,
      },
    });
  };

  const openGroup = (group: CompletedGroup) => {
    if (
      group.type === "movie" &&
      group.items.length === 1 &&
      !group.items[0].seasonTitle
    ) {
      handlePlay(group.items[0]);
      return;
    }
    navigate(`/downloads/series/${encodeURIComponent(group.showName)}`);
  };

  const isEmpty = activeDownloads.length === 0 && completedGroups.length === 0;

  return (
    <main className="downloads-page">
      <header className="downloads-page-header">
        <div className="downloads-page-icon" aria-hidden="true">
          <Download size={27} />
        </div>
        <div>
          <p className="downloads-eyebrow">Offline library</p>
          <h1>Downloads</h1>
          <p>
            {allDownloads.length
              ? `${allDownloads.length} ${allDownloads.length === 1 ? "item" : "items"} stored or in progress`
              : "Keep movies and episodes ready for offline playback"}
          </p>
        </div>
      </header>

      {isEmpty ? (
        <section
          className="downloads-empty-state"
          aria-labelledby="downloads-empty-title"
        >
          <div className="downloads-empty-icon" aria-hidden="true">
            <HardDrive size={35} />
          </div>
          <h2 id="downloads-empty-title">Nothing downloaded yet</h2>
          <p>Download a movie or episode and its progress will appear here.</p>
        </section>
      ) : (
        <div className="downloads-content">
          {activeDownloads.length > 0 && (
            <section
              className="downloads-section"
              aria-labelledby="active-downloads-title"
            >
              <div className="downloads-section-heading">
                <div>
                  <p className="downloads-section-kicker">In progress</p>
                  <h2 id="active-downloads-title">Active downloads</h2>
                </div>
                <span className="downloads-count-chip">
                  {activeDownloads.length}
                </span>
              </div>

              <div className="active-downloads-list">
                {activeDownloads.map((item) => {
                  const progress = item.totalBytes
                    ? Math.min(
                        100,
                        Math.round(
                          (item.downloadedBytes / item.totalBytes) * 100,
                        ),
                      )
                    : 0;

                  return (
                    <article className="active-download-card" key={item.id}>
                      <div
                        className="download-row-poster"
                        style={{
                          backgroundImage: item.poster
                            ? `url(${item.poster})`
                            : undefined,
                        }}
                        aria-hidden="true"
                      >
                        {!item.poster && <Download size={24} />}
                      </div>

                      <div className="download-row-copy">
                        <div className="download-row-title-line">
                          <div>
                            <h3 title={item.episodeName || item.title}>
                              {getCleanTitle(item)}
                            </h3>
                            {item.type === "series" && item.showName && (
                              <p>
                                {item.showName}
                                {item.seasonTitle
                                  ? ` · ${item.seasonTitle}`
                                  : ""}
                              </p>
                            )}
                          </div>
                          <span
                            className={`download-status-chip status-${item.status}`}
                          >
                            {item.status === "error" ? (
                              <AlertCircle size={14} />
                            ) : (
                              <Clock size={14} />
                            )}
                            {statusCopy[item.status]}
                          </span>
                        </div>

                        <div
                          className={`download-progress-track ${item.status === "queued" ? "is-indeterminate" : ""}`}
                          role="progressbar"
                          aria-label={`${getCleanTitle(item)} download progress`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={
                            item.status === "queued" ? undefined : progress
                          }
                        >
                          <span
                            style={{
                              width: `${item.status === "queued" ? 34 : progress}%`,
                            }}
                          />
                        </div>

                        <div className="download-row-meta">
                          {item.status === "queued" ? (
                            <span>Waiting for an available download slot</span>
                          ) : item.status === "paused" ? (
                            <span>
                              {formatBytes(item.downloadedBytes)} of{" "}
                              {formatBytes(item.totalBytes)}
                            </span>
                          ) : item.status === "error" ? (
                            <span
                              style={{
                                color: "var(--error, #ef4444)",
                                fontWeight: 500,
                              }}
                              title={item.error}
                            >
                              {item.error || "Download failed. Resume to retry."}
                            </span>
                          ) : (
                            <>
                              <span>
                                {formatBytes(item.downloadedBytes)} of{" "}
                                {formatBytes(item.totalBytes)}
                              </span>
                              <span className="download-speed">
                                {formatBytes(item.speed)}/s
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div
                        className="download-row-actions"
                        aria-label={`Actions for ${getCleanTitle(item)}`}
                      >
                        {item.status === "queued" && (
                          <FocusableButton
                            className="download-action-button is-primary"
                            onClick={() => startNow(item.id)}
                            title="Start now"
                          >
                            <Rocket size={19} />
                          </FocusableButton>
                        )}
                        {item.status === "downloading" && (
                          <FocusableButton
                            className="download-action-button"
                            onClick={() => pauseDownload(item.id)}
                            title="Pause download"
                          >
                            <Pause size={19} />
                          </FocusableButton>
                        )}
                        {(item.status === "paused" ||
                          item.status === "error") && (
                          <FocusableButton
                            className="download-action-button is-primary"
                            onClick={() => resumeDownload(item.id)}
                            title="Resume download"
                          >
                            <Play size={19} />
                          </FocusableButton>
                        )}
                        <FocusableButton
                          className="download-action-button is-danger"
                          onClick={() => cancelDownload(item.id)}
                          title="Cancel download"
                        >
                          <X size={19} />
                        </FocusableButton>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {completedGroups.length > 0 && (
            <section
              className="downloads-section"
              aria-labelledby="completed-downloads-title"
            >
              <div className="downloads-section-heading">
                <div>
                  <p className="downloads-section-kicker">Ready to watch</p>
                  <h2 id="completed-downloads-title">Downloaded</h2>
                </div>
                <span className="downloads-count-chip">
                  {completedGroups.length}
                </span>
              </div>

              <div className="download-library-grid">
                {completedGroups.map((group) => (
                  <DownloadedLibraryCard
                    key={group.showName}
                    group={group}
                    onOpen={() => openGroup(group)}
                    onDelete={() => {
                      group.items.forEach((item) => void cancelDownload(item.id));
                    }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
};

const DownloadedLibraryCard: React.FC<{
  group: CompletedGroup;
  onOpen: () => void;
  onDelete: () => void;
}> = ({ group, onOpen, onDelete }) => {
  const isAndroid = navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const cardFocusKey = `DOWNLOAD_GROUP_${group.showName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const deleteFocusKey = `${cardFocusKey}_DELETE`;

  const {
    ref: deleteRef,
    focused: deleteFocused,
    focusSelf: focusDelete,
  } = useFocusable({
    focusKey: deleteFocusKey,
    focusable: tvMode,
    onEnterPress: onDelete,
    onArrowPress: (direction) => {
      if (direction === "down") {
        focusCard();
        return false;
      }
      return true;
    },
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  const {
    ref: cardRef,
    focused: cardFocused,
    focusSelf: focusCard,
  } = useFocusable({
    focusKey: cardFocusKey,
    focusable: tvMode,
    onEnterPress: onOpen,
    onArrowPress: (direction) => {
      if (direction === "up") {
        focusDelete();
        return false;
      }
      return true;
    },
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  return (
    <article
      className={`download-library-card ${cardFocused ? "is-focused" : ""} ${deleteFocused ? "is-child-focused" : ""}`}
    >
      <div
        ref={cardRef as any}
        className={`download-library-poster ${cardFocused ? "tv-focus" : ""} ${deleteFocused ? "child-focused" : ""}`}
        style={{ backgroundImage: group.poster ? `url(${group.poster})` : undefined }}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (
            e.key === "Delete" ||
            e.key === "Backspace" ||
            e.key === "x" ||
            e.key === "X"
          ) {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }
        }}
        role="button"
        aria-label={`Play or open ${group.showName}`}
        tabIndex={tvMode ? -1 : 0}
      >
        {!group.poster && <Download size={30} />}
        <span className="download-library-play" aria-hidden="true">
          <Play size={22} fill="currentColor" />
        </span>
      </div>

      <div className="download-library-copy">
        <h3 title={group.showName}>{group.showName}</h3>
        <p>
          {group.items.length > 1
            ? `${group.items.length} episodes · `
            : ""}
          {formatBytes(group.totalBytes)}
        </p>
      </div>

      <button
        ref={deleteRef as any}
        type="button"
        className={`download-library-delete ${deleteFocused ? "tv-focus focused" : ""}`}
        onClick={(event: React.MouseEvent) => {
          event.stopPropagation();
          onDelete();
        }}
        title={`Delete ${group.showName}`}
        aria-label={`Delete ${group.showName}`}
        tabIndex={tvMode ? -1 : 0}
      >
        <Trash2 size={18} />
      </button>
    </article>
  );
};

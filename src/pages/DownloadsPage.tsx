import React, { useMemo } from "react";
import { useDownloadStore, DownloadItem } from "../lib/zustand/downloadStore";
import {
  LuPlay as Play,
  LuPause as Pause,
  LuX as X,
  LuTrash2 as Trash2,
  LuCircleAlert as AlertCircle,
} from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { FocusableButton } from "../components/layout/FocusableButton";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../lib/storage";
import "./DownloadsPage.css";

export const DownloadsPage = () => {
  const { downloads, pauseDownload, resumeDownload, cancelDownload } =
    useDownloadStore();
  const navigate = useNavigate();

  const allDownloads = Object.values(downloads);

  const activeDownloads = useMemo(
    () =>
      allDownloads.filter((d) =>
        ["downloading", "queued", "paused", "error"].includes(d.status),
      ),
    [allDownloads],
  );

  const completedDownloads = useMemo(
    () => allDownloads.filter((d) => d.status === "completed"),
    [allDownloads],
  );

  const groupedCompleted = useMemo(() => {
    const groups: Record<
      string,
      {
        showName: string;
        poster: string;
        type: "movie" | "series";
        items: DownloadItem[];
        totalBytes: number;
      }
    > = {};

    completedDownloads.forEach((item) => {
      const key = item.showName || item.title;
      if (!groups[key]) {
        groups[key] = {
          showName: key,
          poster: item.poster || "",
          type: item.type || "movie",
          items: [],
          totalBytes: 0,
        };
      }
      groups[key].items.push(item);
      groups[key].totalBytes += item.totalBytes || 0;
    });

    return Object.values(groups);
  }, [completedDownloads]);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getCleanTitle = (item: DownloadItem) => {
    if (item.showName) {
      if (item.episodeName) {
        return `${item.showName} - ${item.episodeName}`;
      }
      return item.showName;
    }
    return item.title || "Unknown Video";
  };

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
          },
        ],
        linkIndex: 0,
        type: "movie", // or tv based on item data, assuming movie for direct local play
        primaryTitle: item.showName || item.title,
        poster: { poster: item.poster },
        providerValue: item.provider || "",
        infoUrl: item.infoUrl || item.filePath,
        doNotTrack: !item.infoUrl,
      },
    });
  };

  const handleGroupClick = (group: any) => {
    if (
      group.type === "movie" &&
      group.items.length === 1 &&
      !group.items[0].seasonTitle
    ) {
      // It's just a direct movie download, play directly
      handlePlay(group.items[0]);
    } else {
      // It's a series or grouped item, navigate to the specific series download page
      navigate(`/downloads/series/${encodeURIComponent(group.showName)}`);
    }
  };

  const handleGroupDelete = (group: any, e: React.MouseEvent) => {
    e.stopPropagation();
    group.items.forEach((item: DownloadItem) => cancelDownload(item.id));
  };

  return (
    <div className="downloads-page">
      <div className="downloads-header">
        <h1 className="headline-lg">Downloads</h1>
      </div>

      <div className="downloads-content">
        {activeDownloads.length > 0 && (
          <section className="downloads-section">
            <h2 className="section-title">Active Downloads</h2>
            <div className="active-downloads-list">
              {activeDownloads.map((item) => {
                const progressPct =
                  item.totalBytes > 0
                    ? Math.min(
                        100,
                        Math.round(
                          (item.downloadedBytes / item.totalBytes) * 100,
                        ),
                      )
                    : 0;

                return (
                  <div key={item.id} className="active-download-card">
                    <div
                      className="card-poster"
                      style={{ backgroundImage: `url(${item.poster || ""})` }}
                    >
                      {!item.poster && <div className="no-poster">N/A</div>}
                    </div>
                    <div className="card-info">
                      <h3
                        className="title-truncate"
                        title={item.episodeName || item.title}
                      >
                        {getCleanTitle(item)}
                      </h3>
                      <div className="progress-bar-container">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <div className="download-meta">
                        {item.status === "error" ? (
                          <span className="text-red-500 flex items-center gap-1">
                            <AlertCircle size={14} /> Error
                          </span>
                        ) : item.status === "paused" ? (
                          <span className="text-yellow-500">Paused</span>
                        ) : (
                          <span>
                            {formatBytes(item.downloadedBytes)} /{" "}
                            {formatBytes(item.totalBytes)}
                            <span className="speed-badge">
                              {formatBytes(item.speed)}/s
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="card-actions">
                      {item.status === "downloading" && (
                        <FocusableButton
                          className="action-btn pause"
                          onClick={() => pauseDownload(item.id)}
                        >
                          <Pause size={20} />
                        </FocusableButton>
                      )}
                      {(item.status === "paused" ||
                        item.status === "error") && (
                        <FocusableButton
                          className="action-btn play"
                          onClick={() => resumeDownload(item.id)}
                        >
                          <Play size={20} />
                        </FocusableButton>
                      )}
                      <FocusableButton
                        className="action-btn cancel"
                        onClick={() => cancelDownload(item.id)}
                      >
                        <X size={20} />
                      </FocusableButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="downloads-section">
          <h2 className="section-title">Completed</h2>
          {groupedCompleted.length === 0 ? (
            <div className="empty-state">
              <p>No completed downloads yet.</p>
            </div>
          ) : (
            <div className="completed-grid">
              {groupedCompleted.map((group) => (
                <div key={group.showName} className="completed-card">
                  <DownloadCardClickable
                    onClick={() => handleGroupClick(group)}
                    poster={group.poster}
                  >
                    <div className="play-overlay">
                      <Play size={40} />
                    </div>
                  </DownloadCardClickable>
                  <div className="card-details">
                    <h4 className="title-truncate">{group.showName}</h4>
                    <p className="size-label">
                      {group.items.length > 1
                        ? `${group.items.length} Episodes • `
                        : ""}
                      {formatBytes(group.totalBytes)}
                    </p>
                  </div>
                  <FocusableButton
                    className="delete-btn"
                    onClick={(e: React.MouseEvent) =>
                      handleGroupDelete(group, e)
                    }
                  >
                    <Trash2 size={16} />
                  </FocusableButton>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const DownloadCardClickable: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
  poster: string;
}> = ({ children, onClick, poster }) => {
  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref, focused } = useFocusable({
    focusable: tvMode,
    onEnterPress: onClick,
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  return (
    <div
      ref={ref as any}
      className={`card-poster ${focused ? "tv-focus" : ""}`}
      onClick={onClick}
      style={{ backgroundImage: `url(${poster || ""})`, cursor: "pointer" }}
    >
      {children}
    </div>
  );
};

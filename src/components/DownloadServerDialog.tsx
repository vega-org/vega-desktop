import React, { useState, useEffect, useMemo } from "react";
import {
  LuX as X,
  LuServer as Server,
  LuDownload as Download,
  LuCircleAlert as AlertCircle,
  LuCopy as Copy,
  LuCheck as Check,
  LuTrash2 as Trash2,
  LuCaptions as Subtitles,
  LuLoaderCircle as Loader,
} from "react-icons/lu";
import { Stream } from "../lib/providers/types";
import { FocusableButton } from "./layout/FocusableButton";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../lib/storage";
import "./DownloadServerDialog.css";

export interface DownloadedSubtitleItem {
  id: string;
  title: string;
  language?: string;
  filePath?: string;
}

export interface StreamSubtitleItem {
  uri: string;
  title: string;
  language?: string;
  type?: string;
}

interface DownloadServerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  streams: Stream[];
  episodeTitle: string;
  onSelect: (stream: Stream) => void;
  loading?: boolean;
  error?: string | null;
  downloaded?: boolean;
  downloadedServer?: string;
  onDelete?: () => void;
  downloadedSubtitles?: DownloadedSubtitleItem[];
  onSelectSubtitle?: (sub: StreamSubtitleItem) => void;
  onDeleteSubtitle?: (subIdOrTitle: string) => void;
}

export const DownloadServerDialog: React.FC<DownloadServerDialogProps> = ({
  isOpen,
  onClose,
  streams,
  episodeTitle,
  onSelect,
  loading = false,
  error,
  downloaded,
  downloadedServer,
  onDelete,
  downloadedSubtitles = [],
  onSelectSubtitle,
  onDeleteSubtitle,
}) => {
  const [activeTab, setActiveTab] = useState<"video" | "subtitles">("video");
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const tvMode = settingsStorage.isTvModeEnabled();
  const {
    ref: focusRef,
    focusKey,
    focusSelf,
  } = useFocusable({
    focusable: tvMode && isOpen,
    trackChildren: true,
    isFocusBoundary: true,
  });

  useEffect(() => {
    if (isOpen) {
      setActiveTab("video");
      if (tvMode) {
        setTimeout(() => {
          focusSelf();
        }, 100);
      }
    }
  }, [isOpen, tvMode, focusSelf]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const rawSubtitles = useMemo(
    () => streams.flatMap((server) => server.subtitles || []).filter(Boolean),
    [streams],
  );

  const streamSubtitles: StreamSubtitleItem[] = useMemo(() => {
    return rawSubtitles
      .filter(
        (sub, index, self) =>
          index ===
          self.findIndex(
            (s: any) =>
              (s.uri || s.url) === (sub.uri || (sub as any).url) ||
              (s.title === sub.title && s.language === sub.language),
          ),
      )
      .map((sub: any) => ({
        uri: sub.uri || sub.url,
        title: sub.title || sub.language || "Subtitle",
        language: sub.language || "Unknown",
        type: sub.type?.includes("vtt") || (sub.uri || sub.url || "").includes(".vtt") ? "vtt" : "srt",
      }));
  }, [rawSubtitles]);

  const undownloadedStreamSubs = useMemo(() => {
    return streamSubtitles.filter(
      (item) =>
        !downloadedSubtitles.some(
          (d) =>
            d.title.toLowerCase().trim() === item.title.toLowerCase().trim(),
        ),
    );
  }, [streamSubtitles, downloadedSubtitles]);

  const hasSubtitles = downloadedSubtitles.length > 0 || streamSubtitles.length > 0;

  if (!isOpen) return null;

  const handleCopy = (e: any, link: string) => {
    e.stopPropagation?.();
    navigator.clipboard.writeText(link);
    setCopiedLink(link);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="download-dialog-overlay" onClick={onClose}>
        <div
          className="download-dialog-content"
          role="dialog"
          aria-modal="true"
          aria-labelledby="download-dialog-title"
          onClick={(e) => e.stopPropagation()}
          ref={focusRef as any}
        >
          <div className="download-dialog-header">
            <div>
              <h2 id="download-dialog-title" className="headline-sm">
                Choose a download source
              </h2>
              <p className="text-muted body-sm mt-xs">{episodeTitle}</p>
            </div>
            <FocusableButton
              className="icon-btn"
              onClick={onClose}
              aria-label="Close download options"
            >
              <X size={24} />
            </FocusableButton>
          </div>

          {hasSubtitles && (
            <div className="download-dialog-tabs-wrapper">
              <div className="download-dialog-tabs">
                <FocusableButton
                  className={`download-dialog-tab ${activeTab === "video" ? "active" : ""}`}
                  onClick={() => setActiveTab("video")}
                >
                  Video
                </FocusableButton>
                <FocusableButton
                  className={`download-dialog-tab ${activeTab === "subtitles" ? "active" : ""}`}
                  onClick={() => setActiveTab("subtitles")}
                >
                  Subtitles ({downloadedSubtitles.length + streamSubtitles.length})
                </FocusableButton>
              </div>
            </div>
          )}

          <div className="download-dialog-body">
            {activeTab === "video" || !hasSubtitles ? (
              <>
                {downloaded ? (
                  <div className="downloaded-banner">
                    <div className="downloaded-banner-info">
                      <Check size={22} className="text-primary" />
                      <div>
                        <h4 className="label-lg">
                          {downloadedServer || "Video is downloaded"}
                        </h4>
                        <p className="body-xs text-muted">Downloaded</p>
                      </div>
                    </div>
                    {onDelete && (
                      <FocusableButton
                        className="delete-download-btn"
                        onClick={() => {
                          onDelete();
                          onClose();
                        }}
                        title="Delete download"
                      >
                        <Trash2 size={16} />
                        <span>Delete</span>
                      </FocusableButton>
                    )}
                  </div>
                ) : loading ? (
                  <div className="empty-state-dialog">
                    <Loader size={38} className="spin text-primary mb-sm" />
                    <p>Finding download servers...</p>
                  </div>
                ) : error || streams.length === 0 ? (
                  <div className="empty-state-dialog">
                    <AlertCircle size={40} className="mb-sm text-yellow-500" />
                    <p>{error || "No downloadable streams found."}</p>
                  </div>
                ) : (
                  <div className="stream-list">
                    {streams.map((stream, idx) => (
                      <FocusableButton
                        key={idx}
                        className="stream-item"
                        onClick={() => {
                          onSelect(stream);
                          onClose();
                        }}
                      >
                        <div className="stream-icon">
                          <Server size={20} />
                        </div>
                        <div className="stream-details">
                          <h4 className="label-lg">
                            {stream.server || "Unknown Server"}
                          </h4>
                          <span className="quality-badge">
                            {stream.quality
                              ? `${stream.quality}`
                              : stream.type.toUpperCase()}
                          </span>
                        </div>
                        <div
                          className="stream-action"
                          style={{
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                          }}
                        >
                          <FocusableButton
                            className="copy-btn"
                            onClick={(e: any) => handleCopy(e, stream.link)}
                            title="Copy Stream Link"
                            style={{
                              border: "none",
                              background: "transparent",
                              padding: "8px",
                            }}
                          >
                            {copiedLink === stream.link ? (
                              <Check size={20} className="text-green-500" />
                            ) : (
                              <Copy size={20} />
                            )}
                          </FocusableButton>
                          <Download size={20} />
                        </div>
                      </FocusableButton>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="stream-list">
                {/* Downloaded Subtitles */}
                {downloadedSubtitles.map((item) => (
                  <div key={item.id} className="downloaded-banner">
                    <div className="downloaded-banner-info">
                      <Check size={20} className="text-primary" />
                      <div>
                        <h4 className="label-lg">
                          {item.language && item.language !== item.title
                            ? `${item.language} - `
                            : ""}
                          {item.title}
                        </h4>
                        <p className="body-xs text-muted">Downloaded Subtitle</p>
                      </div>
                    </div>
                    {onDeleteSubtitle && (
                      <FocusableButton
                        className="delete-download-btn"
                        onClick={() => {
                          onDeleteSubtitle(item.id);
                          onClose();
                        }}
                        title="Delete subtitle"
                      >
                        <Trash2 size={16} />
                        <span>Delete</span>
                      </FocusableButton>
                    )}
                  </div>
                ))}

                {/* Available Stream Subtitles */}
                {loading ? (
                  <div
                    className="empty-state-dialog"
                    style={{
                      minHeight: downloadedSubtitles.length > 0 ? "120px" : "190px",
                    }}
                  >
                    <Loader size={32} className="spin text-primary mb-sm" />
                    <p>Finding subtitles...</p>
                  </div>
                ) : (
                  <>
                    {undownloadedStreamSubs.map((sub, idx) => (
                      <FocusableButton
                        key={idx}
                        className="stream-item"
                        onClick={() => {
                          if (onSelectSubtitle) {
                            onSelectSubtitle(sub);
                            onClose();
                          }
                        }}
                      >
                        <div className="stream-icon subtitle-icon-badge">
                          <Subtitles size={20} />
                        </div>
                        <div className="stream-details">
                          <h4 className="label-lg">
                            {sub.language && sub.language !== sub.title
                              ? `${sub.language} - `
                              : ""}
                            {sub.title}
                          </h4>
                          <span className="quality-badge">
                            {sub.type?.toUpperCase() || "SRT"}
                          </span>
                        </div>
                        <div
                          className="stream-action"
                          style={{
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                          }}
                        >
                          <FocusableButton
                            className="copy-btn"
                            onClick={(e: any) => handleCopy(e, sub.uri)}
                            title="Copy Subtitle Link"
                            style={{
                              border: "none",
                              background: "transparent",
                              padding: "8px",
                            }}
                          >
                            {copiedLink === sub.uri ? (
                              <Check size={20} className="text-green-500" />
                            ) : (
                              <Copy size={20} />
                            )}
                          </FocusableButton>
                          <Download size={20} />
                        </div>
                      </FocusableButton>
                    ))}

                    {downloadedSubtitles.length === 0 &&
                      undownloadedStreamSubs.length === 0 && (
                        <div className="empty-state-dialog">
                          <AlertCircle size={40} className="mb-sm text-yellow-500" />
                          <p>No subtitles found for this stream.</p>
                        </div>
                      )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
};

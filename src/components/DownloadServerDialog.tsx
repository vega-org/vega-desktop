import React, { useState, useEffect } from "react";
import {
  LuX as X,
  LuServer as Server,
  LuDownload as Download,
  LuCircleAlert as AlertCircle,
  LuCopy as Copy,
  LuCheck as Check,
} from "react-icons/lu";
import { Stream } from "../lib/providers/types";
import { FocusableButton } from "./layout/FocusableButton";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../lib/storage";
import "./DownloadServerDialog.css";

interface DownloadServerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  streams: Stream[];
  episodeTitle: string;
  onSelect: (stream: Stream) => void;
}

export const DownloadServerDialog: React.FC<DownloadServerDialogProps> = ({
  isOpen,
  onClose,
  streams,
  episodeTitle,
  onSelect,
}) => {
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
    if (isOpen && tvMode) {
      setTimeout(() => {
        focusSelf();
      }, 100);
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

          <div className="download-dialog-body">
            {streams.length === 0 ? (
              <div className="empty-state-dialog">
                <AlertCircle size={40} className="mb-sm text-yellow-500" />
                <p>No downloadable streams found.</p>
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
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
};

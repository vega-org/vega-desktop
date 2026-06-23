import React, { useState } from 'react';
import { X, Server, Download, AlertCircle, Copy, Check } from 'lucide-react';
import { Stream } from '../lib/providers/types';
import './DownloadServerDialog.css';

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
  onSelect
}) => {
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (e: React.MouseEvent, link: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(link);
    setCopiedLink(link);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  return (
    <div className="download-dialog-overlay" onClick={onClose}>
      <div className="download-dialog-content" onClick={e => e.stopPropagation()}>
        <div className="download-dialog-header">
          <div>
            <h2 className="headline-sm">Download Options</h2>
            <p className="text-muted body-sm mt-xs">{episodeTitle}</p>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={24} />
          </button>
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
                <div
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
                    <h4 className="label-lg">{stream.server || 'Unknown Server'}</h4>
                    <span className="quality-badge">
                      {stream.quality ? `${stream.quality}` : stream.type.toUpperCase()}
                    </span>
                  </div>
                  <div className="stream-action">
                    <button
                      className="copy-btn"
                      onClick={(e) => handleCopy(e, stream.link)}
                      title="Copy Stream Link"
                    >
                      {copiedLink === stream.link ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
                    </button>
                    <Download size={20} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import { useMemo } from "react";
import { buildSegmentCells } from "../lib/downloadSegmentMap";
import type { DownloadConnectionDetails } from "../lib/zustand/downloadConnectionsStore";

const CELL_COUNT = 30 * 6;

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${Number((bytes / 1024 ** unit).toFixed(1))} ${units[unit]}`;
};

/**
 * IDM-style view of one download: a map of the file where each box fills as
 * its bytes arrive, and the connections working on it.
 */
export const DownloadConnectionsPanel = ({
  details,
  totalBytes,
}: {
  details: DownloadConnectionDetails;
  totalBytes: number;
}) => {
  const cells = useMemo(
    () => buildSegmentCells(totalBytes, details.ranges, CELL_COUNT),
    [totalBytes, details.ranges],
  );
  const activeRanges = details.ranges.filter((range) => range.active);

  return (
    <div className="download-connections-panel">
      <div className="download-connections-header">
        <span>Connections</span>
        <strong>
          {details.connections} active · limit {details.connectionLimit}
        </strong>
      </div>

      <div className="download-segment-grid" aria-hidden="true">
        {cells.map((cell, index) => (
          <span
            key={index}
            className={`download-segment-cell${cell.active ? " is-active" : ""}`}
          >
            <span style={{ height: `${cell.fill * 100}%` }} />
          </span>
        ))}
      </div>

      {activeRanges.length > 0 && (
        <ol className="download-connection-list">
          {activeRanges.map((range, index) => (
            <li key={range.start}>
              <span className="download-connection-index">{index + 1}</span>
              <span className="download-connection-range">
                {formatBytes(range.start)} · {formatBytes(range.end - range.start)}{" "}
                left
              </span>
              <span className="download-connection-speed">
                {formatBytes(range.speed)}/s
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

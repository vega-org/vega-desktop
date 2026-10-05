/** A byte range still downloading, as the download manager reports it. */
export interface DownloadRange {
  start: number;
  /** Exclusive. */
  end: number;
  /** Bytes per second over the last report. */
  speed: number;
  /** A connection is downloading this range. */
  active: boolean;
}

export interface SegmentCell {
  /** Downloaded share of the cell, 0 to 1. */
  fill: number;
  /** A connection is writing inside this cell. */
  active: boolean;
}

/**
 * Splits the file into equal cells and works out how much of each is
 * downloaded: everything outside the ranges still downloading is done.
 */
export const buildSegmentCells = (
  totalBytes: number,
  ranges: DownloadRange[],
  cellCount: number,
): SegmentCell[] => {
  if (totalBytes <= 0 || cellCount <= 0) return [];
  const cellSize = totalBytes / cellCount;
  return Array.from({ length: cellCount }, (_, index) => {
    const cellStart = index * cellSize;
    const cellEnd = cellStart + cellSize;
    let missing = 0;
    let active = false;
    for (const range of ranges) {
      const overlap =
        Math.min(range.end, cellEnd) - Math.max(range.start, cellStart);
      if (overlap > 0) missing += overlap;
      if (range.active && range.start >= cellStart && range.start < cellEnd) {
        active = true;
      }
    }
    return { fill: Math.max(0, Math.min(1, 1 - missing / cellSize)), active };
  });
};

/** Parses the backend `details.ranges` entries: [start, end, speed, active]. */
export const parseDownloadRanges = (value: unknown): DownloadRange[] =>
  Array.isArray(value)
    ? value
        .filter(
          (entry): entry is [number, number, number, boolean] =>
            Array.isArray(entry) &&
            entry.length >= 4 &&
            typeof entry[0] === "number" &&
            typeof entry[1] === "number" &&
            typeof entry[2] === "number",
        )
        .map(([start, end, speed, active]) => ({
          start,
          end,
          speed,
          active: Boolean(active),
        }))
    : [];

import type { DownloadItem } from "./zustand/downloadStore";

const getEpisodeNumber = (item: DownloadItem): number => {
  const idMatch = item.id.match(/_E(\d+)$/i);
  if (idMatch) {
    return Number(idMatch[1]);
  }
  const source = item.episodeName || item.title;
  const titleMatch = source.match(/(?:episode|episodes|ep|e)[\s_.-]*(\d+)/i);
  return titleMatch ? Number(titleMatch[1]) : Number.MAX_SAFE_INTEGER;
};

export const sortDownloadedEpisodes = (
  items: DownloadItem[],
): DownloadItem[] =>
  [...items].sort((a, b) => {
    const episodeDifference = getEpisodeNumber(a) - getEpisodeNumber(b);
    if (episodeDifference !== 0) {
      return episodeDifference;
    }
    return (
      (a.createdAt || a.completedAt || 0) -
        (b.createdAt || b.completedAt || 0) || a.id.localeCompare(b.id)
    );
  });
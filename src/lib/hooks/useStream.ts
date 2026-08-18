import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

import { providerManager } from "../services/ProviderManager";
import { settingsStorage } from "../storage";

import { Stream } from "../providers/types";
import {
  useDownloadStore,
  isVideoDownloadItem,
  isSubtitleDownloadItem,
} from "../zustand/downloadStore";

interface UseStreamOptions {
  activeEpisode: any;
  routeParams: any;
  provider: string;
  enabled?: boolean;
}

// Stable reference for the "no data yet" case. An inline `= []` default would
// create a new array on every render while the query is loading, which makes
// every effect depending on `streamData` re-run and re-render endlessly.
const EMPTY_STREAMS: Stream[] = [];

const getSubtitleKey = (subs: any[]) =>
  subs.map((sub) => sub?.url || sub?.uri || "").join("|");

const getCompletedDownload = (activeEpisode: any, routeParams: any) => {
  const downloads = useDownloadStore.getState().downloads;
  if (activeEpisode?.localFile) {
    return Object.values(downloads).find(
      (item) =>
        isVideoDownloadItem(item) &&
        item.status === "completed" &&
        item.filePath === activeEpisode.link,
    );
  }
  const sourceMatch = Object.values(downloads).find(
    (item) =>
      isVideoDownloadItem(item) &&
      item.status === "completed" &&
      item.sourceLink &&
      item.sourceLink === activeEpisode?.link,
  );
  if (sourceMatch) {
    return sourceMatch;
  }
  const baseTitle = routeParams?.primaryTitle || "Unknown Title";
  const id =
    routeParams?.type === "series"
      ? `${baseTitle}_S${routeParams?.secondaryTitle}_E${(routeParams?.linkIndex || 0) + 1}`
      : `${baseTitle}_direct_${routeParams?.linkIndex || 0}`;
  const item = downloads[id];
  return isVideoDownloadItem(item) && item?.status === "completed" ? item : undefined;
};

const getDownloadedSubtitles = async (
  activeEpisode: any,
  routeParams: any,
): Promise<any[]> => {
  const downloads = useDownloadStore.getState().downloads;
  const baseTitle = routeParams?.primaryTitle || "Unknown Title";
  const episodeBaseId =
    routeParams?.type === "series"
      ? `${baseTitle}_S${routeParams?.secondaryTitle}_E${(routeParams?.linkIndex || 0) + 1}`
      : `${baseTitle}_direct_${routeParams?.linkIndex || 0}`;

  const downloadedSubs: any[] = [];
  const completedSubItems = Object.values(downloads).filter(
    (item) =>
      isSubtitleDownloadItem(item) &&
      item.status === "completed" &&
      (item.id.startsWith(`${episodeBaseId}_subtitle_`) ||
        (item.infoUrl &&
          (item.infoUrl === routeParams?.link ||
            item.infoUrl === routeParams?.infoUrl) &&
          item.sourceLink === activeEpisode?.link) ||
        (item.sourceLink && item.sourceLink === activeEpisode?.link)),
  );

  for (const sub of completedSubItems) {
    if (!sub.filePath) continue;
    let fullPath = sub.filePath;
    if (sub.baseDir && !fullPath.includes(":") && !fullPath.startsWith("/")) {
      try {
        const { join } = await import("@tauri-apps/api/path");
        fullPath = await join(sub.baseDir, sub.filePath);
      } catch {}
    }
    const subTitle = sub.id.includes("_subtitle_")
      ? sub.id.split("_subtitle_")[1]
      : sub.episodeName || sub.title;
    downloadedSubs.push({
      url: fullPath,
      language: subTitle || "Unknown",
      title: `${subTitle || "Subtitle"} (Downloaded)`,
    });
  }

  const downloadedItem = getCompletedDownload(activeEpisode, routeParams);
  if (downloadedItem?.baseDir && downloadedItem?.filePath) {
    try {
      const files = await invoke<{ path: string; language: string }[]>(
        "list_download_subtitles",
        {
          baseDir: downloadedItem.baseDir,
          filePath: downloadedItem.filePath,
        },
      );
      for (const file of files) {
        if (!downloadedSubs.some((s) => s.url === file.path)) {
          downloadedSubs.push({
            url: file.path,
            language: file.language || "Unknown",
            title: `${file.language || "Subtitle"} (Downloaded)`,
          });
        }
      }
    } catch (error) {
      console.error("Failed to load local subtitles from dir:", error);
    }
  }

  return downloadedSubs;
};

const createLocalStream = (
  filePath: string,
  subtitles: any[] = [],
  baseDir?: string,
): Stream => ({
  server: "Local File",
  link: filePath,
  type: "mp4",
  subtitles,
  localBaseDir: baseDir,
});

const loadLocalStream = async (
  filePath: string,
  baseDir?: string,
  downloadedSubs: any[] = [],
): Promise<Stream> => {
  return createLocalStream(filePath, downloadedSubs, baseDir);
};

export const useStream = ({
  activeEpisode,
  routeParams,
  provider,
  enabled = true,
}: UseStreamOptions) => {
  const [selectedStream, setSelectedStream] = useState<Stream>({
    server: "",
    link: "",
    type: "",
  });
  const [externalSubs, setExternalSubs] = useState<any[]>([]);
  const downloadedItem = getCompletedDownload(activeEpisode, routeParams);
  const localFilePath = activeEpisode?.localFile
    ? activeEpisode.link
    : downloadedItem?.filePath;
  // Memoized so the placeholder keeps a stable identity across renders. A new
  // array here would become a new `streamData` reference on every render while
  // the query loads, reintroducing the render loop for downloaded episodes.
  const localPlaceholder = useMemo(
    () =>
      localFilePath
        ? [createLocalStream(localFilePath, [], downloadedItem?.baseDir)]
        : undefined,
    [localFilePath, downloadedItem?.baseDir],
  );

  const {
    data: streamData = EMPTY_STREAMS,
    isLoading,
    error,
    refetch,
  } = useQuery<Stream[], Error>({
    queryKey: [
      "stream",
      activeEpisode?.link,
      activeEpisode?.sourceLink,
      localFilePath,
      routeParams?.type,
      provider,
    ],
    queryFn: async () => {
      if (!activeEpisode?.link) {
        return [];
      }

      console.log("Fetching stream for:", activeEpisode);
      const downloadedSubs = await getDownloadedSubtitles(activeEpisode, routeParams);
      const localStream = localFilePath
        ? await loadLocalStream(localFilePath, downloadedItem?.baseDir, downloadedSubs)
        : null;
      const remoteLink = activeEpisode?.localFile
        ? activeEpisode.sourceLink || downloadedItem?.sourceLink
        : activeEpisode.link;
      if (!remoteLink) {
        return localStream ? [localStream] : [];
      }

      // Fetch streams from provider
      let data: Stream[] = [];
      try {
        const controller = new AbortController();
        data =
          (await providerManager.getStream({
            link: remoteLink,
            type: routeParams?.type,
            signal: controller.signal,
            providerValue: routeParams?.providerValue || provider,
          })) || [];
      } catch (error) {
        if (localStream) {
          console.warn(
            "Remote stream refresh failed; using local file:",
            error,
          );
          return [localStream];
        }
        throw error;
      }

      // Filter out excluded qualities
      const excludedQualities = settingsStorage.getExcludedQualities() || [];
      const filteredQualities = data?.filter(
        (streamItem) => !excludedQualities.includes(streamItem?.quality + "p"),
      );

      let finalStreams =
        filteredQualities?.length > 0 ? filteredQualities : data;

      if (localStream) {
        finalStreams = [localStream, ...finalStreams];
      }

      if (!finalStreams || finalStreams.length === 0) {
        throw new Error("No streams available");
      }

      return finalStreams;
    },
    enabled: enabled && !!activeEpisode?.link,
    placeholderData: localPlaceholder,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: (failureCount, _error) => {
      if (failureCount >= 2) {
        return false;
      }
      return true;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Update selected stream when data changes
  useEffect(() => {
    if (streamData && streamData.length > 0) {
      setSelectedStream(streamData[0]);
    }
  }, [streamData]);

  // Extract downloaded and online external subtitles
  useEffect(() => {
    let isMounted = true;
    (async () => {
      const downloadedSubs = await getDownloadedSubtitles(activeEpisode, routeParams);

      const onlineSubs: any[] = [];
      if (streamData && streamData.length > 0) {
        streamData.forEach((track) => {
          if (track?.subtitles?.length && track.subtitles.length > 0) {
            onlineSubs.push(...track.subtitles);
          }
        });
      }

      const mergedSubs = [...downloadedSubs];
      onlineSubs.forEach((online) => {
        const onlineUrl = online.url || online.uri;
        if (
          !mergedSubs.some(
            (existing) =>
              existing.url === onlineUrl || existing.uri === onlineUrl,
          )
        ) {
          mergedSubs.push(online);
        }
      });

      if (isMounted) {
        // Only replace state when the resolved list actually differs, otherwise
        // a fresh array reference would retrigger this effect on every render.
        setExternalSubs((prev) =>
          getSubtitleKey(prev) === getSubtitleKey(mergedSubs)
            ? prev
            : mergedSubs,
        );
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [streamData, downloadedItem]);

  // Handle errors
  useEffect(() => {
    if (error) {
      console.error("Stream fetch error:", error);
      const errorMessage = error?.message || "No stream found, try again later";
      console.warn(errorMessage);
    }
  }, [error]);

  const switchToNextStream = () => {
    if (streamData && streamData.length > 0) {
      const currentIndex = streamData.indexOf(selectedStream);
      if (currentIndex < streamData.length - 1) {
        setSelectedStream(streamData[currentIndex + 1]);
        console.warn("Network error: No network connection available");
        return true;
      }
    }
    return false;
  };

  return {
    streamData,
    selectedStream,
    setSelectedStream,
    externalSubs,
    setExternalSubs,
    isLoading,
    error,
    refetch,
    switchToNextStream,
  };
};

// Hook for managing video tracks and settings
export const useVideoSettings = () => {
  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [textTracks, setTextTracks] = useState<any[]>([]);
  const [videoTracks, setVideoTracks] = useState<any[]>([]);

  const [loadedVideoSize, setLoadedVideoSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const [selectedAudioTrackIndex, setSelectedAudioTrackIndex] = useState(0);
  const [selectedTextTrackIndex, setSelectedTextTrackIndex] = useState(1000);
  const [selectedQualityIndex, setSelectedQualityIndex] = useState(1000);

  const processAudioTracks = (tracks: any[]) => {
    const uniqueMap = new Map();
    tracks.forEach((track) => {
      const key = `${track.type}-${track.title}-${track.language}`;
      const existingTrack = uniqueMap.get(key);

      if (!existingTrack) {
        uniqueMap.set(key, track);
        return;
      }

      if (track.selected && !existingTrack.selected) {
        uniqueMap.set(key, { ...existingTrack, ...track, selected: true });
      }
    });

    const uniqueTracks = Array.from(uniqueMap.values());
    const selectedIndex = uniqueTracks.findIndex((track) => track.selected);

    setAudioTracks(uniqueTracks);
    if (selectedIndex !== -1) {
      setSelectedAudioTrackIndex(selectedIndex);
    }
  };

  const processVideoTracks = (tracks: any[]) => {
    if (!tracks || tracks.length === 0) {
      return;
    }
    const uniqueMap = new Map();
    const uniqueTracks = tracks.filter((track) => {
      const key = `bitrate-${track.bitrate}-quality ${track.height}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, true);
        return true;
      }
      return false;
    });
    console.log("Processing video tracks:", uniqueTracks);
    setVideoTracks(uniqueTracks);
  };

  const handleVideoLoad = (naturalSize?: {
    width?: number;
    height?: number;
  }) => {
    if (!naturalSize?.height) {
      return;
    }
    setLoadedVideoSize({
      width: naturalSize.width ?? 0,
      height: naturalSize.height ?? 0,
    });
  };

  // Clear everything when switching to a new stream/episode.
  const resetVideoTracks = () => {
    setVideoTracks([]);
    setLoadedVideoSize(null);
  };

  const effectiveVideoTracks = useMemo(() => {
    if (videoTracks.length > 0) {
      return videoTracks;
    }
    if (loadedVideoSize?.height) {
      return [
        {
          width: loadedVideoSize.width,
          height: loadedVideoSize.height,
          bitrate: 0,
          codecs: "",
          trackId: "0",
          index: 0,
          rotation: 0,
          selected: true,
        },
      ];
    }
    return videoTracks;
  }, [videoTracks, loadedVideoSize]);

  return {
    audioTracks,
    textTracks,
    videoTracks: effectiveVideoTracks,
    selectedAudioTrackIndex,
    selectedTextTrackIndex,
    selectedQualityIndex,
    setAudioTracks,
    setTextTracks,
    setVideoTracks,
    setSelectedAudioTrackIndex,
    setSelectedTextTrackIndex,
    setSelectedQualityIndex,
    processAudioTracks,
    processVideoTracks,
    handleVideoLoad,
    resetVideoTracks,
  };
};

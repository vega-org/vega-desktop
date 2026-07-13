import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";

import { providerManager } from "../services/ProviderManager";
import { settingsStorage } from "../storage";

import { Stream } from "../providers/types";
import { useDownloadStore } from "../zustand/downloadStore";

interface UseStreamOptions {
  activeEpisode: any;
  routeParams: any;
  provider: string;
  enabled?: boolean;
}

const getCompletedDownload = (activeEpisode: any, routeParams: any) => {
  const downloads = useDownloadStore.getState().downloads;
  if (activeEpisode?.localFile) {
    return Object.values(downloads).find(
      (item) =>
        item.status === "completed" && item.filePath === activeEpisode.link,
    );
  }
  const sourceMatch = Object.values(downloads).find(
    (item) =>
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
  return item?.status === "completed" ? item : undefined;
};

const createLocalStream = (
  filePath: string,
  subtitles: any[] = [],
): Stream => ({
  server: "Local File",
  link: filePath,
  type: "mp4",
  subtitles,
});

const loadLocalStream = async (filePath: string): Promise<Stream> => {
  const subtitles: any[] = [];
  try {
    const { readDir } = await import("@tauri-apps/plugin-fs");
    const slashIndex = Math.max(
      filePath.lastIndexOf("\\"),
      filePath.lastIndexOf("/"),
    );
    const directoryPath = filePath.substring(0, slashIndex);
    const baseName = filePath.substring(
      slashIndex + 1,
      filePath.lastIndexOf("."),
    );
    const files = await readDir(directoryPath);
    for (const file of files) {
      if (
        file.name?.startsWith(`${baseName}.`) &&
        (file.name.endsWith(".vtt") || file.name.endsWith(".srt"))
      ) {
        const language = file.name.substring(
          baseName.length + 1,
          file.name.lastIndexOf("."),
        );
        const separator =
          directoryPath.endsWith("\\") || directoryPath.endsWith("/")
            ? ""
            : "/";
        subtitles.push({
          url: `${directoryPath}${separator}${file.name}`,
          language,
        });
      }
    }
  } catch (error) {
    console.error("Failed to load local subtitles:", error);
  }
  return createLocalStream(filePath, subtitles);
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
  const localPlaceholder = localFilePath
    ? [createLocalStream(localFilePath)]
    : undefined;

  const {
    data: streamData = [],
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
      const localStream = localFilePath
        ? await loadLocalStream(localFilePath)
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

      // Extract external subtitles
      const subs: any[] = [];
      streamData.forEach((track) => {
        if (track?.subtitles?.length && track.subtitles.length > 0) {
          subs.push(...track.subtitles);
        }
      });
      setExternalSubs(subs);
    }
  }, [streamData]);

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

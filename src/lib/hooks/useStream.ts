import {useQuery} from '@tanstack/react-query';
import {useState, useEffect, useMemo} from 'react';

import {providerManager} from '../services/ProviderManager';
import {settingsStorage} from '../storage';
import {ifExists} from '../file/ifExists';
import {Stream} from '../providers/types';
import {useDownloadStore} from '../zustand/downloadStore';

interface UseStreamOptions {
  activeEpisode: any;
  routeParams: any;
  provider: string;
  enabled?: boolean;
}

export const useStream = ({
  activeEpisode,
  routeParams,
  provider,
  enabled = true,
}: UseStreamOptions) => {
  const [selectedStream, setSelectedStream] = useState<Stream>({
    server: '',
    link: '',
    type: '',
  });
  const [externalSubs, setExternalSubs] = useState<any[]>([]);

  const {
    data: streamData = [],
    isLoading,
    error,
    refetch,
  } = useQuery<Stream[], Error>({
    queryKey: ['stream', activeEpisode?.link, routeParams?.type, provider],
    queryFn: async () => {
      if (!activeEpisode?.link) {
        return [];
      }

      console.log('Fetching stream for:', activeEpisode);

      // Handle direct URL (downloaded content via provider='local')
      if (routeParams?.providerValue === 'local' || provider === 'local') {
        return [
          {server: 'Local File', link: activeEpisode.link, type: 'mp4'},
        ];
      }

      // Check Zustand store for completed download
      const downloads = useDownloadStore.getState().downloads;
      const baseTitle = routeParams?.primaryTitle || 'Unknown Title';
      let id = '';
      if (routeParams?.type === 'series') {
        id = `${baseTitle}_S${routeParams?.secondaryTitle}_E${(routeParams?.linkIndex || 0) + 1}`;
      } else {
        id = `${baseTitle}_direct_${routeParams?.linkIndex || 0}`;
      }
      
      const downloadedItem = downloads[id];
      let localStream: Stream | null = null;
      if (downloadedItem && downloadedItem.status === 'completed') {
        localStream = { server: 'Local File', link: downloadedItem.filePath, type: 'mp4' };
      }

      // Fetch streams from provider
      const controller = new AbortController();
      const data = await providerManager.getStream({
        link: activeEpisode.link,
        type: routeParams?.type,
        signal: controller.signal,
        providerValue: routeParams?.providerValue || provider,
      });

      // Filter out excluded qualities
      const excludedQualities = settingsStorage.getExcludedQualities() || [];
      const filteredQualities = data?.filter(
        streamItem => !excludedQualities.includes(streamItem?.quality + 'p'),
      );

      let finalStreams = filteredQualities?.length > 0 ? filteredQualities : (data || []);
      
      if (localStream) {
        finalStreams = [localStream, ...finalStreams];
      }

      if (!finalStreams || finalStreams.length === 0) {
        throw new Error('No streams available');
      }

      return finalStreams;
    },
    enabled: enabled && !!activeEpisode?.link,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: (failureCount, _error) => {
      if (failureCount >= 2) {
        return false;
      }
      return true;
    },
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 10000),
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Update selected stream when data changes
  useEffect(() => {
    if (streamData && streamData.length > 0) {
      setSelectedStream(streamData[0]);

      // Extract external subtitles
      const subs: any[] = [];
      streamData.forEach(track => {
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
      console.error('Stream fetch error:', error);
      const errorMessage = error?.message || 'No stream found, try again later';
      console.warn(errorMessage);
    }
  }, [error]);

  const switchToNextStream = () => {
    if (streamData && streamData.length > 0) {
      const currentIndex = streamData.indexOf(selectedStream);
      if (currentIndex < streamData.length - 1) {
        setSelectedStream(streamData[currentIndex + 1]);
        console.warn('Network error: No network connection available');
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
    tracks.forEach(track => {
      const key = `${track.type}-${track.title}-${track.language}`;
      const existingTrack = uniqueMap.get(key);

      if (!existingTrack) {
        uniqueMap.set(key, track);
        return;
      }

      if (track.selected && !existingTrack.selected) {
        uniqueMap.set(key, {...existingTrack, ...track, selected: true});
      }
    });

    const uniqueTracks = Array.from(uniqueMap.values());
    const selectedIndex = uniqueTracks.findIndex(track => track.selected);

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
    const uniqueTracks = tracks.filter(track => {
      const key = `bitrate-${track.bitrate}-quality ${track.height}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, true);
        return true;
      }
      return false;
    });
        console.log('Processing video tracks:', uniqueTracks);
    setVideoTracks(uniqueTracks);
  };


  const handleVideoLoad = (naturalSize?: {width?: number; height?: number}) => {
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
          codecs: '',
          trackId: '0',
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

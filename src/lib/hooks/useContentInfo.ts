import {useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import {providerManager} from '../services/ProviderManager';
import {cacheStorage} from '../storage';
import axios from 'axios';

const getContentInfoCacheKey = (link: string, providerValue: string) =>
  `contentInfo:${providerValue}:${link}`;

const getEnhancedMetadataCacheKey = (imdbId: string, type: string) =>
  `enhancedMeta:${type}:${imdbId}`;

// Hook for fetching content info/metadata
export const useContentInfo = (link: string, providerValue: string) => {
  const cacheKey = getContentInfoCacheKey(link, providerValue);
  const query = useQuery({
    queryKey: ['contentInfo', link, providerValue],
    queryFn: async () => {
      console.log('Fetching content info for:', link);

      const data = await providerManager.getMetaData({
        link,
        provider: providerValue,
      });
      if (!data || (!data?.title && !data?.synopsis && !data?.image)) {
        throw new Error('Error: No data returned from provider');
      }

      return data;
    },
    enabled: !!link && !!providerValue,
    staleTime: 0,
    gcTime: 60 * 60 * 1000, // 1 hour
    retry: 2,
    initialData: () => {
      const cached = cacheStorage.getString(cacheKey) || cacheStorage.getString(link);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    initialDataUpdatedAt: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    if (query.data) {
      cacheStorage.setString(cacheKey, JSON.stringify(query.data));
    }
  }, [cacheKey, query.data]);

  return query;
};

// Hook for fetching enhanced metadata from Stremio
export const useEnhancedMetadata = (imdbId: string, type: string) => {
  const cacheKey = getEnhancedMetadataCacheKey(imdbId, type);
  const query = useQuery({
    queryKey: ['enhancedMeta', imdbId, type],
    queryFn: async () => {
      console.log('Fetching enhanced metadata for:', imdbId);
      try {
        // Validate imdbId and type
        if (!imdbId || !type) {
          throw new Error('Invalid imdbId or type');
        }
      } catch (error) {
        console.log('Error validating imdbId or type:', error);
        return {};
      }
      const response = await axios.get(
        `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`,
        {timeout: 10000},
      );

      return response.data?.meta;
    },
    enabled: !!imdbId && !!type,
    staleTime: 30 * 60 * 1000, // 30 minutes - metadata changes rarely
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
    retry: 1, // Don't retry too much for external API
    initialData: () => {
      const cached =
        cacheStorage.getString(cacheKey) || cacheStorage.getString(imdbId);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    initialDataUpdatedAt: 0,
  });

  useEffect(() => {
    if (query.data && imdbId) {
      cacheStorage.setString(cacheKey, JSON.stringify(query.data));
    }
  }, [cacheKey, imdbId, query.data]);

  return query;
};

// Combined hook for both info and metadata
export const useContentDetails = (link: string, providerValue: string) => {
  // First, get the basic content info
  const {
    data: info,
    isLoading: infoLoading,
    isFetching: infoFetching,
    error: infoError,
    refetch: refetchInfo,
  } = useContentInfo(link, providerValue);

  // Then, get enhanced metadata if imdbId is available
  const {
    data: meta,
    isLoading: metaLoading,
    isFetching: metaFetching,
    error: metaError,
    refetch: refetchMeta,
  } = useEnhancedMetadata(info?.imdbId || '', info?.type || '');

  return {
    info,
    meta,
    isLoading: infoLoading || metaLoading,
    isRefetching: infoFetching || metaFetching,
    error: infoError || metaError,
    refetch: async () => {
      await Promise.all([refetchInfo(), refetchMeta()]);
    },
  };
};

import {useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import {getHomePageData, HomePageData} from '../getHomepagedata';
import {Content} from '../zustand/contentStore';
import {cacheStorage} from '../storage';

interface UseHomePageDataOptions {
  provider: Content['provider'];
  enabled?: boolean;
}

export const useHomePageData = ({
  provider,
  enabled = true,
}: UseHomePageDataOptions) => {
  const cacheKey = 'homeData' + (provider?.value || '');
  const query = useQuery<HomePageData[], Error>({
    queryKey: ['homePageData', provider.value],
    queryFn: async ({signal}) => {
      // Fetch fresh data from provider
      const data = await getHomePageData(provider, signal);
      return data;
    },
    enabled: enabled && !!provider?.value,
    staleTime: 0, // Mark stale immediately so it revalidates in the background
    gcTime: 60 * 60 * 1000, // 1 hour
    retry: (failureCount, error) => {
      if (error.name === 'AbortError') {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
    // Add initial data from cache for instant loading without loading screen
    initialData: () => {
      const cache = cacheStorage.getString(cacheKey);
      if (cache) {
        try {
          return JSON.parse(cache);
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    initialDataUpdatedAt: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: 'always',
  });

  useEffect(() => {
    if (query.data && query.data.length > 0 && provider?.value) {
      cacheStorage.setString(cacheKey, JSON.stringify(query.data));
    }
  }, [cacheKey, provider?.value, query.data]);

  return query;
};

// Store hero selection per provider to prevent re-randomization on tab switch
const heroSelectionCache = new Map<
  string,
  {postIndex: number; categoryIndex: number}
>();

// Memoized hero selection with stable reference - uses cached index to prevent re-randomization
export const getRandomHeroPost = (
  homeData: HomePageData[],
  providerValue?: string,
) => {
  if (!homeData || homeData.length === 0) {
    return null;
  }

  // Find the last category that actually has posts
  let lastCategory = null;
  let categoryIndex = homeData.length - 1;
  
  for (let i = homeData.length - 1; i >= 0; i--) {
    if (homeData[i].Posts && homeData[i].Posts.length > 0) {
      lastCategory = homeData[i];
      categoryIndex = i;
      break;
    }
  }

  if (!lastCategory || !lastCategory.Posts || lastCategory.Posts.length === 0) {
    return null;
  }

  const cacheKey = providerValue || 'default';
  const cached = heroSelectionCache.get(cacheKey);

  // If we have a cached index and it's still valid for this data, use it
  if (cached && cached.postIndex < lastCategory.Posts.length) {
    return lastCategory.Posts[cached.postIndex];
  }

  // Otherwise, generate a new random index and cache it
  const randomIndex = Math.floor(Math.random() * lastCategory.Posts.length);
  heroSelectionCache.set(cacheKey, {
    postIndex: randomIndex,
    categoryIndex: categoryIndex,
  });

  return lastCategory.Posts[randomIndex];
};

// Function to clear hero cache when explicitly refreshing
export const clearHeroCache = (providerValue?: string) => {
  if (providerValue) {
    heroSelectionCache.delete(providerValue);
  } else {
    heroSelectionCache.clear();
  }
};

// New hook for hero metadata with React Query, instant cache load & background revalidation
export const useHeroMetadata = (heroLink: string, providerValue: string) => {
  const cacheKey = `heroMeta:${providerValue}:${heroLink}`;
  const query = useQuery({
    queryKey: ['heroMetadata', heroLink, providerValue],
    queryFn: async () => {
      const {providerManager} = await import('../services/ProviderManager');
      const {default: axios} = await import('axios');

      const info = await providerManager.getMetaData({
        link: heroLink,
        provider: providerValue,
      });

      // Only enrich providers that explicitly opt in to Cinemeta metadata.
      if (info.populateMeta === true && info.imdbId && info.type) {
        try {
          const response = await axios.get(
            `https://v3-cinemeta.strem.io/meta/${info.type}/${info.imdbId}.json`,
            {timeout: 5000},
          );
          return response.data?.meta || info;
        } catch {
          return info; // Fallback to original info if Stremio fails
        }
      }

      return info;
    },
    enabled: !!heroLink && !!providerValue,
    staleTime: 0, // Instantly revalidate in background
    gcTime: 60 * 60 * 1000, // 1 hour
    retry: 2,
    // Use cached data as initial data
    initialData: () => {
      const cached =
        cacheStorage.getString(cacheKey) || cacheStorage.getString(heroLink);
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
    if (query.data && heroLink) {
      cacheStorage.setString(cacheKey, JSON.stringify(query.data));
      cacheStorage.setString(heroLink, JSON.stringify(query.data));
    }
  }, [cacheKey, heroLink, query.data]);

  return query;
};

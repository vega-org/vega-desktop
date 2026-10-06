import {useEffect, useState} from 'react';
import {QueryClient, useQuery, useQueryClient} from '@tanstack/react-query';
import {getHomePageData, HomePageData} from '../getHomepagedata';
import {Content} from '../zustand/contentStore';
import {cacheStorage} from '../storage';
import type {Post} from '../providers/types';

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

export const HERO_COUNT = 4;
const HERO_ROTATE_MS = 8000;
// Longest wait for an idle moment before the other heroes load.
const HERO_IDLE_TIMEOUT_MS = 3000;
// Prefetched hero details stay fresh this long, so rotating back does not refetch.
const HERO_PREFETCH_STALE_MS = 10 * 60 * 1000;

// Hero links per provider, so tab switches and catalog refetches keep the same heroes.
const heroSelectionCache = new Map<string, string[]>();

const shuffle = <T,>(items: T[]): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/**
 * Picks up to HERO_COUNT random posts, kept per provider. The last catalog
 * with posts comes first; the others fill up when it has too few.
 */
export const getRandomHeroPosts = (
  homeData: HomePageData[],
  providerValue?: string,
): Post[] => {
  const pool = new Map<string, Post>();
  const primaryLinks: string[] = [];
  const otherLinks: string[] = [];
  const categories = (homeData || []).filter(category => category.Posts?.length);
  categories.forEach((category, categoryIndex) => {
    const isPrimary = categoryIndex === categories.length - 1;
    for (const post of category.Posts) {
      if (post?.link && !pool.has(post.link)) {
        pool.set(post.link, post);
        (isPrimary ? primaryLinks : otherLinks).push(post.link);
      }
    }
  });
  if (pool.size === 0) {
    return [];
  }

  const cacheKey = providerValue || 'default';
  const cached = (heroSelectionCache.get(cacheKey) || [])
    .map(link => pool.get(link))
    .filter((post): post is Post => !!post);
  if (cached.length > 0) {
    return cached;
  }

  const links = [...shuffle(primaryLinks), ...shuffle(otherLinks)].slice(
    0,
    HERO_COUNT,
  );
  heroSelectionCache.set(cacheKey, links);
  return links.map(link => pool.get(link)!);
};

// Function to clear hero cache when explicitly refreshing
export const clearHeroCache = (providerValue?: string) => {
  if (providerValue) {
    heroSelectionCache.delete(providerValue);
  } else {
    heroSelectionCache.clear();
  }
};

const heroMetadataKey = (heroLink: string, providerValue: string) => [
  'heroMetadata',
  heroLink,
  providerValue,
];

const heroStorageKey = (heroLink: string, providerValue: string) =>
  `heroMeta:${providerValue}:${heroLink}`;

const readStoredHeroMetadata = (heroLink: string, providerValue: string) => {
  const cached =
    cacheStorage.getString(heroStorageKey(heroLink, providerValue)) ||
    cacheStorage.getString(heroLink);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const fetchHeroMetadata = async (heroLink: string, providerValue: string) => {
  const {providerManager} = await import('../services/ProviderManager');
  const {default: axios} = await import('axios');

  const info = await providerManager.getMetaData({
    link: heroLink,
    provider: providerValue,
  });

  let result = info;
  // Only enrich providers that explicitly opt in to Cinemeta metadata.
  if (info.populateMeta === true && info.imdbId && info.type) {
    try {
      const response = await axios.get(
        `https://v3-cinemeta.strem.io/meta/${info.type}/${info.imdbId}.json`,
        {timeout: 5000},
      );
      result = response.data?.meta || info;
    } catch {
      result = info; // Fallback to original info if Stremio fails
    }
  }

  const serialized = JSON.stringify(result);
  cacheStorage.setString(heroStorageKey(heroLink, providerValue), serialized);
  cacheStorage.setString(heroLink, serialized);
  return result;
};

// Hook for hero metadata with React Query, instant cache load & background revalidation
export const useHeroMetadata = (heroLink: string, providerValue: string) =>
  useQuery({
    queryKey: heroMetadataKey(heroLink, providerValue),
    queryFn: () => fetchHeroMetadata(heroLink, providerValue),
    enabled: !!heroLink && !!providerValue,
    staleTime: 0, // Instantly revalidate in background
    gcTime: 60 * 60 * 1000, // 1 hour
    retry: 2,
    // Use cached data as initial data
    initialData: () => readStoredHeroMetadata(heroLink, providerValue),
    initialDataUpdatedAt: 0,
    refetchOnMount: 'always',
  });

/**
 * Loads one hero's details in the background. Stored details make the hero
 * ready at once and are refreshed quietly. Resolves false when nothing could
 * be loaded.
 */
const prefetchHeroMetadata = async (
  queryClient: QueryClient,
  heroLink: string,
  providerValue: string,
): Promise<boolean> => {
  const queryKey = heroMetadataKey(heroLink, providerValue);
  const stored = readStoredHeroMetadata(heroLink, providerValue);
  if (stored !== undefined && queryClient.getQueryData(queryKey) === undefined) {
    queryClient.setQueryData(queryKey, stored, {updatedAt: 0});
  }
  try {
    await queryClient.fetchQuery({
      queryKey,
      queryFn: () => fetchHeroMetadata(heroLink, providerValue),
      staleTime: HERO_PREFETCH_STALE_MS,
      retry: 1,
    });
    return true;
  } catch {
    return queryClient.getQueryData(queryKey) !== undefined;
  }
};

/**
 * Rotates the hero through `posts`. The first hero's details load right after
 * the catalog; once that request is done and the app is idle, the others load
 * one at a time in the background. Only heroes whose details have loaded join
 * the rotation, so a slide never shows up half empty.
 */
/**
 * True when an image would look poor stretched across the hero: portrait or
 * square posters and small images.
 */
export const isPosterLikeArtwork = (width: number, height: number) =>
  width / height < 1.2 || width < 1000;

export const useHeroRotation = (
  posts: Post[],
  providerValue: string,
  paused: boolean,
) => {
  const queryClient = useQueryClient();
  const linksKey = posts.map(post => post.link).join('\n');
  const firstLink = posts[0]?.link || '';
  const [index, setIndex] = useState(0);
  const [readyLinks, setReadyLinks] = useState<string[]>([]);

  const firstQuery = useHeroMetadata(firstLink, providerValue);
  const firstDone =
    !!firstLink &&
    !firstQuery.isFetching &&
    (firstQuery.data !== undefined || firstQuery.isError);

  useEffect(() => {
    setIndex(0);
    setReadyLinks(firstLink ? [firstLink] : []);
  }, [linksKey, firstLink, providerValue]);

  useEffect(() => {
    if (!firstDone || posts.length < 2) {
      return;
    }
    let cancelled = false;
    const rest = posts.slice(1);
    const loadRest = async () => {
      for (const post of rest) {
        if (cancelled) {
          return;
        }
        const ready = await prefetchHeroMetadata(
          queryClient,
          post.link,
          providerValue,
        );
        if (!cancelled && ready) {
          setReadyLinks(current =>
            current.includes(post.link) ? current : [...current, post.link],
          );
        }
      }
    };
    // WKWebView on macOS has no requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(() => void loadRest(), {
        timeout: HERO_IDLE_TIMEOUT_MS,
      });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(() => void loadRest(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // linksKey stands for posts: the list is rebuilt on every catalog refetch.
  }, [firstDone, linksKey, providerValue, queryClient]);

  useEffect(() => {
    if (paused || readyLinks.length < 2) {
      return;
    }
    const timer = setInterval(() => {
      setIndex(current => {
        for (let step = 1; step <= posts.length; step++) {
          const next = (current + step) % posts.length;
          if (readyLinks.includes(posts[next].link)) {
            return next;
          }
        }
        return current;
      });
    }, HERO_ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, posts, readyLinks]);

  const activeIndex = index < posts.length ? index : 0;
  return {
    post: posts[activeIndex] as Post | undefined,
    activeIndex,
    readyLinks,
  };
};

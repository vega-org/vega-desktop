import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { providerManager } from '../services/ProviderManager';
import { Post } from '../providers/types';
import useContentStore from '../zustand/contentStore';

export interface SearchPageData {
  title: string;
  Posts: Post[];
  filter: string;
  providerValue: string;
  value: string;
  name: string;
}

export const useGlobalSearch = (query: string) => {
  const { installedProviders } = useContentStore();
  const [searchData, setSearchData] = useState<SearchPageData[]>([]);
  const [emptyResults, setEmptyResults] = useState<SearchPageData[]>([]);
  
  const trueLoading = useMemo(
    () =>
      installedProviders.map(item => ({
        name: item.display_name,
        value: item.value,
        isLoading: true,
        error: undefined as string | undefined,
      })),
    [installedProviders]
  );

  const [loading, setLoading] = useState(trueLoading);
  const abortController = useRef<AbortController | null>(null);

  const searchDataRef = useRef<SearchPageData[]>([]);
  const emptyResultsRef = useRef<SearchPageData[]>([]);

  const updateSearchData = useCallback((newData: SearchPageData) => {
    searchDataRef.current = [...searchDataRef.current, newData];
    setSearchData(searchDataRef.current);
  }, []);

  const updateEmptyResults = useCallback((newData: SearchPageData) => {
    emptyResultsRef.current = [...emptyResultsRef.current, newData];
    setEmptyResults(emptyResultsRef.current);
  }, []);

  const updateLoading = useCallback(
    (value: string, updates: Partial<{ isLoading: boolean; error: string }>) => {
      setLoading(prev =>
        prev.map(i => (i.value === value ? { ...i, ...updates } : i))
      );
    },
    []
  );

  const isAllLoaded = useMemo(
    () => loading.every(i => !i.isLoading),
    [loading]
  );

  useEffect(() => {
    if (!query) {
      setSearchData([]);
      setEmptyResults([]);
      setLoading([]);
      return;
    }

    if (abortController.current) {
      abortController.current.abort();
    }

    abortController.current = new AbortController();
    const signal = abortController.current.signal;

    searchDataRef.current = [];
    emptyResultsRef.current = [];
    setSearchData([]);
    setEmptyResults([]);
    setLoading(trueLoading);

    const fetchPromises: Promise<void>[] = [];

    installedProviders.forEach(item => {
      const fetchPromise = (async () => {
        try {
          const data = await providerManager.getSearchPosts({
            searchQuery: query,
            page: 1,
            providerValue: item.value,
            signal: signal,
          });

          if (signal.aborted) return;

          const newData = {
            title: item.display_name,
            Posts: data || [],
            filter: query,
            providerValue: item.value,
            value: item.value,
            name: item.display_name,
          };

          if (data && data.length > 0) {
            updateSearchData(newData);
          } else {
            updateEmptyResults(newData);
          }

          updateLoading(item.value, { isLoading: false });
        } catch (error: any) {
          if (signal.aborted) return;

          console.error(`Error fetching data for ${item.display_name}:`, error);
          const errorMessage = error?.message || 'Failed to search';
          updateLoading(item.value, { isLoading: false, error: errorMessage });
        }
      })();

      fetchPromises.push(fetchPromise);
    });

    Promise.allSettled(fetchPromises);

    return () => {
      if (abortController.current) {
        abortController.current.abort();
        abortController.current = null;
      }
    };
  }, [query, installedProviders, trueLoading, updateSearchData, updateEmptyResults, updateLoading]);

  return { searchData, emptyResults, loading, isAllLoaded };
};

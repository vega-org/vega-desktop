import { useQuery } from '@tanstack/react-query';
import { providerManager } from '../services/ProviderManager';
import { Post } from '../providers/types';

export const useSearch = (query: string, providerValue: string | undefined, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['search', query, providerValue],
    queryFn: async (): Promise<Post[]> => {
      if (!providerValue || !query) return [];
      try {
        const results = await providerManager.getSearchPosts({
          searchQuery: query,
          page: 1,
          providerValue,
          signal: new AbortController().signal
        });
        return results || [];
      } catch (error) {
        console.error('Search error:', error);
        throw error;
      }
    },
    enabled: !!providerValue && !!query && enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

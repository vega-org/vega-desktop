import { cacheStorageService } from "./storage";
import { queryClient } from "./client";
import { clearHeroCache } from "./hooks/useHomePageData";

export const clearAppCache = async (): Promise<void> => {
  cacheStorageService.clearAll();
  queryClient.clear();
  clearHeroCache();
};

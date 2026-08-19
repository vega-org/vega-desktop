import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { LuArrowLeft as ArrowLeft } from "react-icons/lu";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { providerManager } from "../lib/services/ProviderManager";
import { PostCardItem, type Post } from "../components/home/PostCardItem";
import { FocusableButton } from "../components/layout/FocusableButton";
import { Skeleton } from "../components/ui/skeleton";
import { settingsStorage } from "../lib/storage";
import "./CatalogPage.css";

interface CatalogScrollState {
  scrollTop: number;
  focusedLink?: string;
}

const catalogStateCache = new Map<string, CatalogScrollState>();

export const CatalogPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const title = searchParams.get("title") || "Catalog";
  const filter = searchParams.get("filter") || "";
  const searchQuery = searchParams.get("searchQuery") || "";
  const providerValue = searchParams.get("provider") || "";
  const navigate = useNavigate();
  const catalogKey = `${providerValue}:${filter}:${searchQuery}`;

  const catalogGridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const restoredRef = useRef(false);

  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref: focusRef, focusKey } = useFocusable({
    focusable: tvMode,
    trackChildren: true,
    saveLastFocusedChild: true,
    autoRestoreFocus: true,
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
    error,
  } = useInfiniteQuery({
    queryKey: ["catalog", providerValue, filter, searchQuery],
    queryFn: async ({ pageParam = 1, signal }) => {
      if (!providerValue) return [];

      if (typeof searchQuery === "string" && searchQuery.trim().length > 0) {
        const posts = await providerManager.getSearchPosts({
          searchQuery,
          page: pageParam,
          providerValue,
          signal,
        });
        return posts || [];
      } else if (typeof filter === "string") {
        const posts = await providerManager.getPosts({
          filter,
          page: pageParam,
          providerValue,
          signal,
        });
        return posts || [];
      }
      return [];
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length === 0) {
        return undefined;
      }
      return allPages.length + 1;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled:
      !!providerValue &&
      (typeof filter === "string" || typeof searchQuery === "string"),
  });

  const posts = useMemo(() => data?.pages.flat() || [], [data]);

  useLayoutEffect(() => {
    const scroller =
      catalogGridRef.current?.closest<HTMLElement>(".layout-content") ||
      document.querySelector<HTMLElement>(".layout-content");
    if (scroller) {
      setScrollElement(scroller);
    }
  }, []);

  // Restore scroll position and TV remote focus when returning from a post
  useEffect(() => {
    if (!scrollElement) return;

    const cached = catalogStateCache.get(catalogKey);
    if (cached && posts.length > 0 && !restoredRef.current) {
      restoredRef.current = true;
      scrollElement.scrollTop = cached.scrollTop;
      if (tvMode && cached.focusedLink) {
        const targetKey = `CATALOG_ITEM_${encodeURIComponent(cached.focusedLink)}`;
        const timer = window.setTimeout(() => {
          setFocus(targetKey);
        }, 60);
        return () => window.clearTimeout(timer);
      }
    } else if (!cached && !restoredRef.current) {
      restoredRef.current = true;
      scrollElement.scrollTo({ top: 0 });
    }
  }, [catalogKey, posts.length, scrollElement, tvMode]);

  // IntersectionObserver for mouse/touch scrolling infinite pagination
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      {
        root: scrollElement,
        rootMargin: "400px",
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, scrollElement]);

  const handlePostClick = useCallback(
    (p: Post) => {
      const scroller =
        scrollElement ||
        catalogGridRef.current?.closest<HTMLElement>(".layout-content");
      if (scroller) {
        catalogStateCache.set(catalogKey, {
          scrollTop: scroller.scrollTop,
          focusedLink: p.link,
        });
      }

      const finalProvider = p.providerValue || providerValue;
      let url = `/content/${encodeURIComponent(p.link)}`;
      const params = new URLSearchParams();
      if (finalProvider) params.append("provider", finalProvider);
      if (p.image) params.append("poster", p.image);
      const queryString = params.toString();
      if (queryString) url += `?${queryString}`;
      navigate(url);
    },
    [catalogKey, navigate, providerValue, scrollElement],
  );

  const handleBackClick = useCallback(() => {
    catalogStateCache.delete(catalogKey);
    navigate(-1);
  }, [catalogKey, navigate]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="catalog-page" ref={focusRef as any}>
        <div className="catalog-header">
          <FocusableButton
            className="icon-btn back-btn"
            onClick={handleBackClick}
          >
            <ArrowLeft size={24} />
          </FocusableButton>
          <h1 className="headline-lg">{title}</h1>
        </div>

        {status === "pending" ? (
          <div className="catalog-grid">
            {[...Array(20)].map((_, i) => (
              <div key={i} className="post-card">
                <Skeleton className="skeleton-card" />
                <Skeleton className="skeleton-card-title" />
              </div>
            ))}
          </div>
        ) : status === "error" ? (
          <div className="empty-state">
            <h2 className="headline-md">Error Loading Content</h2>
            <p className="body-lg text-muted">
              {error?.message || "Something went wrong"}
            </p>
          </div>
        ) : posts.length === 0 ? (
          <div className="empty-state">
            <h2 className="headline-md">No Content Found</h2>
            <p className="body-lg text-muted">
              There are no items in this category.
            </p>
          </div>
        ) : (
          <div ref={catalogGridRef} className="catalog-grid">
            {posts.map((post, index) => (
              <PostCardItem
                key={`${post.link}-${index}`}
                post={post}
                focusKey={`CATALOG_ITEM_${encodeURIComponent(post.link)}`}
                onClick={handlePostClick}
                onFocus={() => {
                  if (
                    index >= posts.length - 8 &&
                    hasNextPage &&
                    !isFetchingNextPage
                  ) {
                    void fetchNextPage();
                  }
                }}
              />
            ))}
          </div>
        )}

        <div ref={sentinelRef} className="catalog-loading-sentinel" />

        {isFetchingNextPage && posts.length > 0 && (
          <div className="catalog-grid catalog-next-page-skeletons">
            {[...Array(8)].map((_, index) => (
              <div key={index} className="post-card">
                <Skeleton className="skeleton-card" />
                <Skeleton className="skeleton-card-title" />
              </div>
            ))}
          </div>
        )}

        <div className="catalog-loading-more">
          {!hasNextPage && posts.length > 0 && !isFetchingNextPage && (
            <p className="text-muted body-md">You've reached the end.</p>
          )}
        </div>
      </div>
    </FocusContext.Provider>
  );
};

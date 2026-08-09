import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LuArrowLeft as ArrowLeft } from "react-icons/lu";
import { providerManager } from "../lib/services/ProviderManager";
import { PostCardItem } from "../components/home/PostCardItem";
import { FocusableButton } from "../components/layout/FocusableButton";
import { Skeleton } from "../components/ui/skeleton";
import "./CatalogPage.css";

export const CatalogPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const title = searchParams.get("title") || "Catalog";
  const filter = searchParams.get("filter") || "";
  const searchQuery = searchParams.get("searchQuery") || "";
  const providerValue = searchParams.get("provider") || "";
  const navigate = useNavigate();
  const catalogGridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const [gridOffset, setGridOffset] = useState(0);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);

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
      // If the last page has no results or fewer than typical page size, stop fetching
      if (!lastPage || lastPage.length === 0) {
        return undefined;
      }
      return allPages.length + 1;
    },
    enabled:
      !!providerValue &&
      (typeof filter === "string" || typeof searchQuery === "string"),
  });

  const posts = useMemo(() => data?.pages.flat() || [], [data]);
  const compactGrid = gridWidth > 0 && gridWidth <= 768;
  const gridGap = compactGrid ? 16 : 20;
  const minimumCardWidth = compactGrid ? 140 : 150;
  const columnCount = Math.max(
    1,
    Math.floor((gridWidth + gridGap) / (minimumCardWidth + gridGap)),
  );
  const rowCount = Math.ceil(posts.length / columnCount);
  const estimatedCardWidth = Math.min(
    190,
    Math.max(
      minimumCardWidth,
      (gridWidth - gridGap * (columnCount - 1)) / columnCount,
    ),
  );
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimatedCardWidth * 1.5 + 72 + gridGap,
    overscan: 3,
    scrollMargin: gridOffset,
    getItemKey: (rowIndex) =>
      `${posts[rowIndex * columnCount]?.link || "row"}-${rowIndex}`,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const lastVirtualRowIndex = virtualRows[virtualRows.length - 1]?.index;

  useLayoutEffect(() => {
    const grid = catalogGridRef.current;
    if (!grid) return;

    const scroller = grid.closest<HTMLElement>(".layout-content");
    setScrollElement(scroller);
    const updateMetrics = () => {
      setGridWidth(grid.clientWidth);
      if (scroller) {
        setGridOffset(
          grid.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top +
            scroller.scrollTop,
        );
      }
    };
    updateMetrics();
    const resizeObserver = new ResizeObserver(updateMetrics);
    resizeObserver.observe(grid);
    window.addEventListener("resize", updateMetrics);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateMetrics);
    };
  }, [posts.length, status]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [columnCount, gridWidth, rowVirtualizer]);

  useEffect(() => {
    scrollElement?.scrollTo({ top: 0 });
  }, [filter, providerValue, scrollElement, searchQuery]);

  useEffect(() => {
    if (
      lastVirtualRowIndex !== undefined &&
      lastVirtualRowIndex >= rowCount - 3 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      void fetchNextPage();
    }
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    lastVirtualRowIndex,
    rowCount,
  ]);

  return (
    <div className="catalog-page">
      <div className="catalog-header">
        <FocusableButton
          className="icon-btn back-btn"
          onClick={() => navigate(-1)}
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
        <div
          ref={catalogGridRef}
          className="catalog-virtual-grid"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {virtualRows.map((virtualRow) => {
            const firstPostIndex = virtualRow.index * columnCount;
            const rowPosts = posts.slice(
              firstPostIndex,
              firstPostIndex + columnCount,
            );
            return (
              <div
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className="catalog-virtual-row"
                style={{
                  gap: `${gridGap}px`,
                  gridTemplateColumns: `repeat(${columnCount}, minmax(${minimumCardWidth}px, 190px))`,
                  paddingBottom: `${gridGap}px`,
                  transform: `translateY(${virtualRow.start - gridOffset}px)`,
                }}>
                {rowPosts.map((post, rowPostIndex) => (
                  <PostCardItem
                    key={`${post.link}-${firstPostIndex + rowPostIndex}`}
                    post={post}
                    onClick={(p) => {
                      const finalProvider =
                        p.providerValue || providerValue;
                      let url = `/content/${encodeURIComponent(p.link)}`;
                      const params = new URLSearchParams();
                      if (finalProvider)
                        params.append("provider", finalProvider);
                      if (p.image) params.append("poster", p.image);
                      const queryString = params.toString();
                      if (queryString) url += `?${queryString}`;
                      navigate(url);
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {isFetchingNextPage && posts.length > 0 && (
        <div className="catalog-grid catalog-next-page-skeletons">
          {[...Array(columnCount)].map((_, index) => (
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
  );
};

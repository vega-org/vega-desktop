import React, { useRef, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { LuArrowLeft as ArrowLeft, LuLoaderCircle as Loader2 } from 'react-icons/lu';
import { providerManager } from '../lib/services/ProviderManager';
import { PostCardItem } from '../components/home/PostCardItem';
import { FocusableButton } from '../components/layout/FocusableButton';
import './CatalogPage.css';

export const CatalogPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const title = searchParams.get('title') || 'Catalog';
  const filter = searchParams.get('filter') || '';
  const searchQuery = searchParams.get('searchQuery') || '';
  const providerValue = searchParams.get('provider') || '';
  const navigate = useNavigate();
  const observerTarget = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
    error
  } = useInfiniteQuery({
    queryKey: ['catalog', providerValue, filter, searchQuery],
    queryFn: async ({ pageParam = 1, signal }) => {
      if (!providerValue) return [];
      
      if (typeof searchQuery === 'string' && searchQuery.trim().length > 0) {
        const posts = await providerManager.getSearchPosts({
          searchQuery,
          page: pageParam,
          providerValue,
          signal
        });
        return posts || [];
      } else if (typeof filter === 'string') {
        const posts = await providerManager.getPosts({
          filter,
          page: pageParam,
          providerValue,
          signal
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
    enabled: !!providerValue && (typeof filter === 'string' || typeof searchQuery === 'string'),
  });

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const element = observerTarget.current;
    if (!element) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0, rootMargin: '400px' });
    observer.observe(element);
    return () => observer.unobserve(element);
  }, [handleObserver]);

  const posts = data?.pages.flat() || [];

  return (
    <div className="catalog-page">
      <div className="catalog-header">
        <FocusableButton className="icon-btn back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={24} />
        </FocusableButton>
        <h1 className="headline-lg">{title}</h1>
      </div>

      {status === 'pending' ? (
        <div className="catalog-grid">
          {[...Array(20)].map((_, i) => (
            <div key={i} className="post-card skeleton-card" />
          ))}
        </div>
      ) : status === 'error' ? (
        <div className="empty-state">
          <h2 className="headline-md">Error Loading Content</h2>
          <p className="body-lg text-muted">{error?.message || 'Something went wrong'}</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="empty-state">
          <h2 className="headline-md">No Content Found</h2>
          <p className="body-lg text-muted">There are no items in this category.</p>
        </div>
      ) : (
        <div className="catalog-grid">
          {posts.map((post, index) => (
            <PostCardItem
              key={`${post.link}-${index}`}
              post={post}
              onClick={(p) => {
                const finalProvider = p.providerValue || providerValue;
                let url = `/content/${encodeURIComponent(p.link)}`;
                const params = new URLSearchParams();
                if (finalProvider) params.append('provider', finalProvider);
                if (p.image) params.append('poster', p.image);
                const queryString = params.toString();
                if (queryString) {
                  url += `?${queryString}`;
                }
                navigate(url);
              }}
            />
          ))}
        </div>
      )}

      {/* Loading trigger / indicator */}
      <div ref={observerTarget} className="catalog-loading-more">
        {isFetchingNextPage ? (
          <Loader2 size={32} className="spin text-primary" />
        ) : hasNextPage ? (
          <div style={{ height: '20px' }} />
        ) : (
          posts.length > 0 && <p className="text-muted body-md">You've reached the end.</p>
        )}
      </div>
    </div>
  );
};

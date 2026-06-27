import React, { useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useHomePageData, getRandomHeroPost } from '../lib/hooks/useHomePageData';
import { useSearch } from '../lib/hooks/useSearch';
import useContentStore from '../lib/zustand/contentStore';
import { Hero } from '../components/home/Hero';
import { ContentSlider } from '../components/home/ContentSlider';
import { LuRefreshCw as RefreshCw, LuPlay as Play, LuLoaderCircle as Loader2 } from 'react-icons/lu';
import useWatchHistoryStore from '../lib/zustand/watchHistrory';
import { FocusableButton } from '../components/layout/FocusableButton';
import './HomePage.css';
import '../pages/SearchPage.css';

export const HomePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const navigate = useNavigate();

  const { provider, installedProviders } = useContentStore();

  const {
    data: homeData = [],
    isLoading: isHomeLoading,
    error: homeError,
    refetch,
    isRefetching
  } = useHomePageData({
    provider,
    enabled: !!(installedProviders?.length && provider?.value && !query)
  });

  const { data: searchResults, isLoading: isSearchLoading, error: searchError } = useSearch(
    query, 
    provider?.value, 
    !!query
  );

  const history = useWatchHistoryStore(state => state.history);

  const heroPost = useMemo(() => {
    if (!homeData || homeData.length === 0) {
      return null;
    }
    return getRandomHeroPost(homeData, provider?.value);
  }, [homeData, provider?.value]);

  const continueWatchingPosts = useMemo(() => {
    return history
      .filter(item => item.progress !== undefined && item.duration !== undefined && item.progress > 0)
      // Hide if essentially completed (e.g., watched 95%)
      .filter(item => (item.progress! / item.duration!) < 0.95)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 10)
      .map(item => ({
        title: item.title,
        link: item.link,
        image: item.poster || '', // Fallback to empty string if no poster
        progress: item.progress! / item.duration!,
        providerValue: item.provider,
        type: item.isSeries ? 'series' : 'movie',
        episodeTitle: item.episodeTitle
      }));
  }, [history]);

  if (!installedProviders || installedProviders.length === 0) {
    return (
      <div className="empty-state">
        <h2 className="headline-lg">Welcome to Vega</h2>
        <p className="body-lg text-muted">Please install an extension to get started.</p>
      </div>
    );
  }

  // Handle Search View
  if (query) {
    return (
      <div className="home-page search-active">
        <div className="search-results-meta mb-md">
          <p className="body-lg text-muted">Showing results for "{query}" on {provider?.display_name}</p>
        </div>

        {isSearchLoading && (
          <div className="search-loading flex justify-center py-xl">
            <Loader2 size={48} className="spin text-primary" />
          </div>
        )}

        {searchError && (
          <div className="error-state">
            <h2 className="headline-md">Failed to search</h2>
            <p className="body-md text-muted">{searchError instanceof Error ? searchError.message : 'An error occurred'}</p>
          </div>
        )}

        {!isSearchLoading && !searchError && searchResults?.length === 0 && (
          <div className="empty-state">
            <h2 className="headline-md">No results found</h2>
            <p className="body-lg text-muted">Try adjusting your search terms or switching providers.</p>
          </div>
        )}

        {!isSearchLoading && !searchError && searchResults && searchResults.length > 0 && (
          <div className="search-grid pb-xl">
            {searchResults.map((post, index) => (
              <FocusableButton 
                key={`${post.link}-${index}`} 
                className="search-card"
                onClick={() => {
                  const params = new URLSearchParams();
                  if (provider?.value) params.append('provider', provider.value);
                  if (post.image) params.append('poster', post.image);
                  navigate(`/content/${encodeURIComponent(post.link)}?${params.toString()}`);
                }}
                style={{ textAlign: 'left', background: 'transparent', border: 'none', padding: 0 }}
              >
                <div className="search-poster-container">
                  <img src={post.image} alt={post.title} className="search-poster" loading="lazy" />
                  <div className="search-hover-overlay">
                    <Play size={48} fill="currentColor" />
                  </div>
                </div>
                <h3 className="search-title label-md">{post.title}</h3>
              </FocusableButton>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (homeError) {
    return (
      <div className="error-state">
        <h2 className="headline-md">Failed to load content</h2>
        <p className="body-md text-muted mb-md">{homeError.message}</p>
        <FocusableButton className="btn-primary" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={isRefetching ? 'spin' : ''} />
          Retry
        </FocusableButton>
      </div>
    );
  }

  // Loading skeleton
  if (isHomeLoading && homeData.length === 0) {
    return (
      <div className="home-page">
        <Hero post={null} />
        <ContentSlider title="Loading..." posts={[]} isLoading={true} />
        <ContentSlider title="Loading..." posts={[]} isLoading={true} />
        <ContentSlider title="Loading..." posts={[]} isLoading={true} />
      </div>
    );
  }

  return (
    <div className="home-page">
      {heroPost && <Hero post={heroPost} />}

      <div className="sliders-section">
        {continueWatchingPosts.length > 0 && (
          <ContentSlider
            title="Continue Watching"
            posts={continueWatchingPosts}
            onRemove={(post, e) => {
              e.stopPropagation();
              useWatchHistoryStore.getState().removeItem({ link: post.link } as any);
            }}
          />
        )}
        {homeData.map((category, index) => (
          <ContentSlider
            key={`category-${index}`}
            title={category.title}
            posts={category.Posts}
            filter={category.filter}
            providerValue={provider?.value}
          />
        ))}
      </div>
    </div>
  );
};

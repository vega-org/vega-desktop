import React, { useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  useHomePageData,
  getRandomHeroPosts,
} from "../lib/hooks/useHomePageData";
import { useSearch } from "../lib/hooks/useSearch";
import useContentStore from "../lib/zustand/contentStore";
import { Hero } from "../components/home/Hero";
import { ContentSlider } from "../components/home/ContentSlider";
import { LuRefreshCw as RefreshCw } from "react-icons/lu";
import useWatchHistoryStore from "../lib/zustand/watchHistrory";
import { settingsStorage } from "../lib/storage";
import { FocusableButton } from "../components/layout/FocusableButton";
import { PostCardItem, parseAspectRatio } from "../components/home/PostCardItem";
import { Spinner } from "../components/ui/spinner";
import "./HomePage.css";
import "../pages/SearchPage.css";
import useLocalContentStore from '../lib/zustand/localContentStore';
import {localContentId, localContentInfo, localContentLink} from '../lib/localContent/library';
import {getLocalContinueWatching} from '../lib/localContent/playback';
import {cacheStorage} from '../lib/storage';

export const HomePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const navigate = useNavigate();

  const provider = useContentStore(state => state.provider);
  const installedProviders = useContentStore(state => state.installedProviders);

  const {
    data: homeData = [],
    isLoading: isHomeLoading,
    error: homeError,
    refetch,
    isRefetching,
  } = useHomePageData({
    provider,
    enabled: !!(installedProviders?.length && provider?.value && !query),
  });

  const {
    data: searchResults,
    isLoading: isSearchLoading,
    error: searchError,
  } = useSearch(query, provider?.value, !!query);

  const history = useWatchHistoryStore((state) => state.history);
  const localTitles = useLocalContentStore(state => state.titles);
  const removeHistoryPost = useCallback((post: {link: string}, e: React.MouseEvent) => {
    e.stopPropagation();
    const localId = localContentId(post.link);
    if (localId) useLocalContentStore.getState().clearPlayback(localId);
    else useWatchHistoryStore.getState().removeItem({link: post.link} as any);
  }, []);
  // Read on mount: Settings is a separate route, so Home remounts after a change.
  const [showContinueWatching] = React.useState(() =>
    settingsStorage.showContinueWatching(),
  );

  // Heroes are kept per provider, so a refetch does not pick new ones.
  const heroPosts = useMemo(
    () => getRandomHeroPosts(homeData, provider?.value),
    [homeData, provider?.value],
  );

  const continueWatchingPosts = useMemo(() => {
    const latestByLink = new Map<string, (typeof history)[number]>();
    const catalogPosters = new Map<string, string>();
    if (provider?.value) {
      homeData.forEach((category) => {
        category.Posts.forEach((post) => {
          if (post.link && post.image && !catalogPosters.has(post.link)) {
            catalogPosters.set(post.link, post.image);
          }
        });
      });
    }
    const localHistory = localTitles.flatMap(title => {
      const target = getLocalContinueWatching(title, uri => {
        try { return JSON.parse(cacheStorage.getString(uri) || 'null') || undefined; } catch { return undefined; }
      });
      if (!target) return [];
      return [{id: localContentLink(title.id), link: localContentLink(title.id),
        title: title.metadata?.title || title.name, provider: 'local',
        poster: title.metadata?.poster || title.metadata?.background,
        progress: target.position, duration: target.duration,
        timestamp: target.updatedAt, episodeTitle: target.title,
        isSeries: localContentInfo(title).type === 'series'}];
    });
    [...history.filter(item => item.provider !== 'local'), ...localHistory]
      .filter(
        (item) =>
          item.progress !== undefined &&
          item.duration !== undefined &&
          (item.provider === 'local' || (item.progress > 0 && item.duration > 0)),
      )
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .forEach((item) => {
        if (!latestByLink.has(item.link)) {
          latestByLink.set(item.link, item);
        }
      });

    return [...latestByLink.values()]
      .slice(0, 10)
      .map((item) => ({
        title: item.title,
        link: item.link,
        image:
          (item.provider === provider?.value
            ? catalogPosters.get(item.link)
            : undefined) ||
          item.poster ||
          "",
        progress: item.duration! > 0 ? Math.min(item.progress! / item.duration!, 1) : 0,
        providerValue: item.provider,
        type: item.isSeries ? "series" : "movie",
        episodeTitle:
          item.episodeTitle ||
          (item.episode?.title && item.episode.title !== item.title
            ? item.episode.title
            : undefined),
      }));
  }, [history, homeData, provider?.value, localTitles]);

  if (!installedProviders || installedProviders.length === 0) {
    return (
      <div className="home-page" style={{paddingTop: 80}}>
        {showContinueWatching && continueWatchingPosts.length > 0 && <ContentSlider title="Continue Watching" posts={continueWatchingPosts} onRemove={removeHistoryPost} />}
      <div className="empty-state">
        <h2 className="headline-lg">Welcome to Vega</h2>
        <p className="body-lg text-muted">
          Add a provider source in Extensions, then install a provider to get started.
        </p>
      </div>
      </div>
    );
  }

  // Handle Search View
  if (query) {
    return (
      <div className="home-page search-active">
        <div className="search-results-meta mb-md">
          <p className="body-lg text-muted">
            Showing results for "{query}" on {provider?.display_name}
          </p>
        </div>

        {isSearchLoading && (
          <div className="search-loading flex justify-center py-xl">
            <Spinner size={48} label="Searching provider" />
          </div>
        )}

        {searchError && (
          <div className="error-state">
            <h2 className="headline-md">Failed to search</h2>
            <p className="body-md text-muted">
              {searchError instanceof Error
                ? searchError.message
                : "An error occurred"}
            </p>
          </div>
        )}

        {!isSearchLoading && !searchError && searchResults?.length === 0 && (
          <div className="empty-state">
            <h2 className="headline-md">No results found</h2>
            <p className="body-lg text-muted">
              Try adjusting your search terms or switching providers.
            </p>
          </div>
        )}

        {!isSearchLoading &&
          !searchError &&
          searchResults &&
          searchResults.length > 0 && (() => {
            const isLandscapeGrid =
              searchResults.filter((post) => parseAspectRatio(post.aspectRatio, 2 / 3) > 1.2).length >
              searchResults.length / 2;
            return (
              <div className={`search-grid pb-xl ${isLandscapeGrid ? "search-grid-landscape" : ""}`}>
                {searchResults.map((post, index) => (
                  <PostCardItem
                    key={`${post.link}-${index}`}
                    post={post}
                    onClick={() => {
                      const params = new URLSearchParams();
                      if (provider?.value)
                        params.append("provider", provider.value);
                      if (post.image) params.append("poster", post.image);
                      navigate(
                        `/content/${encodeURIComponent(post.link)}?${params.toString()}`,
                      );
                    }}
                  />
                ))}
              </div>
            );
          })()}
      </div>
    );
  }

  if (homeError && (!homeData || homeData.length === 0)) {
    return (
      <div className="error-state">
        <h2 className="headline-md">Failed to load content</h2>
        <p className="body-md text-muted mb-md">{homeError.message}</p>
        <FocusableButton
          className="btn-primary"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw className={isRefetching ? "spin" : ""} />
          Retry
        </FocusableButton>
      </div>
    );
  }

  // Loading skeleton
  if (isHomeLoading && homeData.length === 0) {
    return (
      <div className="home-page">
        <Hero posts={[]} />
        <ContentSlider title="Loading..." posts={[]} isLoading={true} />
        <ContentSlider title="Loading..." posts={[]} isLoading={true} />
        <ContentSlider title="Loading..." posts={[]} isLoading={true} />
      </div>
    );
  }

  return (
    <div className="home-page">
      {heroPosts.length > 0 && <Hero posts={heroPosts} />}

      <div
        className="sliders-section"
        style={heroPosts.length === 0 ? { marginTop: "100px" } : undefined}
      >
        {showContinueWatching && continueWatchingPosts.length > 0 && (
          <ContentSlider
            title="Continue Watching"
            posts={continueWatchingPosts}
            onRemove={removeHistoryPost}
          />
        )}
        {homeData.map((category, index) => (
          <ContentSlider
            key={`${provider?.value}-category-${index}-${category.title}`}
            title={category.title}
            posts={category.Posts}
            filter={category.filter}
            providerValue={provider?.value}
            windowRows
            defer={index > 0}
          />
        ))}
      </div>
    </div>
  );
};

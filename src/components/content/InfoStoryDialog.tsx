import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  LuBookOpen,
  LuCalendar,
  LuChartBar,
  LuChartNoAxesCombined,
  LuChevronLeft,
  LuChevronRight,
  LuClapperboard,
  LuClock3,
  LuDollarSign,
  LuFilm,
  LuGlobe,
  LuHash,
  LuInfo,
  LuLoaderCircle,
  LuPlay,
  LuRefreshCw,
  LuStar,
  LuTrendingUp,
  LuTv,
  LuUsers,
  LuX,
} from "react-icons/lu";
import { useTmdbStory } from "../../lib/hooks/useTmdbStory";
import { FocusableButton } from "../layout/FocusableButton";

interface InfoStoryDialogProps {
  backdrop?: string;
  description?: string;
  imdbId?: string;
  onClose: () => void;
  open: boolean;
  title: string;
  tmdbId?: number | string;
  type?: string;
}

interface StoryPage {
  key:
    | "about"
    | "trailer"
    | "cast"
    | "facts"
    | "boxoffice"
    | "ratings"
    | "related"
    | "collection";
  label: string;
}

interface StoryFact {
  icon: ComponentType<{ size?: number }>;
  label: string;
  value: string;
}

const tmdbImageUrl = (
  path?: string,
  size: "w342" | "w780" | "original" = "w780",
) =>
  path?.startsWith("http")
    ? path
    : path
      ? `https://image.tmdb.org/t/p/${size}${path}`
      : undefined;

const formatRuntime = (minutes?: number) => {
  if (!minutes) return undefined;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h ${remaining}m` : `${remaining}m`;
};

const compactNumber = (value?: number) =>
  value
    ? new Intl.NumberFormat("en", { notation: "compact" }).format(value)
    : undefined;

const formatRating = (value?: number | string) => {
  if (value === undefined || value === null || value === "") return undefined;
  const num = typeof value === "number" ? value : parseFloat(String(value));
  return isNaN(num) ? undefined : num.toFixed(1);
};

const formatCurrency = (value?: number): string | undefined => {
  if (!value && value !== 0) return undefined;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    const formatted = (value / 1_000_000_000).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
    return `$${formatted} billion`;
  }
  if (abs >= 1_000_000) {
    const formatted = (value / 1_000_000).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
    return `$${formatted} million`;
  }
  if (abs >= 1_000) {
    const formatted = (value / 1_000).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
    return `$${formatted} thousand`;
  }
  return `$${value.toLocaleString("en-US")}`;
};

export function InfoStoryDialog({
  backdrop,
  description,
  imdbId,
  onClose,
  open,
  title,
  tmdbId,
  type,
}: InfoStoryDialogProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [backdropIndex, setBackdropIndex] = useState(0);
  const { data, error, isFetching, refetch } = useTmdbStory({
    enabled: open,
    imdbId,
    tmdbId,
    type,
  });

  const hasBoxOffice = Boolean(
    data?.productionBudget ||
    data?.worldwideGross ||
    data?.domesticGross ||
    data?.openingWeekendGross,
  );
  const hasHistogram = Boolean(data?.ratingsHistogram?.length);
  const hasRelated = Boolean(data?.relatedTitles?.length);

  const pages = useMemo<StoryPage[]>(() => {
    const result: StoryPage[] = [{ key: "about", label: "About" }];
    if (data?.trailerKey || data?.trailerUrl || data?.trailers?.length)
      result.push({ key: "trailer", label: "Trailer" });
    if (data?.cast.length) result.push({ key: "cast", label: "Cast" });
    if (hasBoxOffice) result.push({ key: "boxoffice", label: "Box Office" });
    if (hasHistogram) result.push({ key: "ratings", label: "Ratings" });
    result.push({ key: "facts", label: "Facts" });
    if (hasRelated) result.push({ key: "related", label: "Related" });
    if (data?.collectionItems.length) {
      result.push({
        key: "collection",
        label: data.mediaType === "tv" ? "Seasons" : "Collection",
      });
    }
    return result;
  }, [data, hasBoxOffice, hasHistogram, hasRelated]);

  const currentPage = pages[Math.min(pageIndex, pages.length - 1)];

  const backdrops = useMemo(() => {
    const paths = (data?.backdropPaths ?? []).map((path) =>
      tmdbImageUrl(path, "original"),
    );
    const trailerThumb = data?.trailerThumbnail;
    return Array.from(
      new Set([...paths, trailerThumb, backdrop].filter(Boolean)),
    ) as string[];
  }, [backdrop, data?.backdropPaths, data?.trailerThumbnail]);

  useEffect(() => {
    if (open) setPageIndex(0);
  }, [open, data?.id]);

  useEffect(() => {
    setBackdropIndex(0);
    if (!open || backdrops.length < 2) return;
    const interval = window.setInterval(
      () => setBackdropIndex((index) => (index + 1) % backdrops.length),
      5000,
    );
    return () => window.clearInterval(interval);
  }, [backdrops, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft")
        setPageIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight")
        setPageIndex((value) => Math.min(pages.length - 1, value + 1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, pages.length]);

  if (!open) return null;

  const facts = data
    ? ([
        data.meterRank
          ? {
              icon: LuTrendingUp,
              label: "IMDb Popularity",
              value: `#${data.meterRank}`,
            }
          : null,
        data.trendingRank
          ? {
              icon: LuTrendingUp,
              label: "Trending this week",
              value: `#${data.trendingRank}`,
            }
          : null,
        formatRating(data.rating)
          ? {
              icon: LuStar,
              label: `${compactNumber(data.voteCount) || "IMDb"} votes`,
              value: `${formatRating(data.rating)}/10`,
            }
          : null,
        data.metascore
          ? { icon: LuHash, label: "Metascore", value: `${data.metascore}` }
          : null,
        data.certification
          ? { icon: LuInfo, label: "Content rating", value: data.certification }
          : null,
        data.releaseDate
          ? {
              icon: LuCalendar,
              label: "Released",
              value: data.releaseDate.slice(0, 4),
            }
          : null,
        data.runtime
          ? {
              icon: LuClock3,
              label: data.mediaType === "tv" ? "Episode runtime" : "Runtime",
              value: formatRuntime(data.runtime)!,
            }
          : null,
        data.status
          ? { icon: LuInfo, label: "Status", value: data.status }
          : null,
        data.watchlistCount
          ? {
              icon: LuUsers,
              label: "Watchlist",
              value: data.watchlistCount.replace("Added by ", ""),
            }
          : null,
        data.totalSeasons
          ? {
              icon: LuTv,
              label: "Seasons",
              value: `${data.totalSeasons} ${data.totalSeasons === 1 ? "season" : "seasons"}`,
            }
          : null,
        data.totalEpisodes
          ? {
              icon: LuTv,
              label: "Episodes",
              value: `${data.totalEpisodes} ${data.totalEpisodes === 1 ? "episode" : "episodes"}`,
            }
          : null,
        data.upcomingSeason
          ? { icon: LuCalendar, label: "Upcoming", value: data.upcomingSeason }
          : null,
      ].filter(Boolean) as StoryFact[])
    : [];

  const goPrevious = () => setPageIndex((value) => Math.max(0, value - 1));
  const goNext = () =>
    setPageIndex((value) => Math.min(pages.length - 1, value + 1));
  const handleHalfClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        "[role='button'], button, a, iframe, video, input, select, textarea, .info-story-navigation, .info-story-video",
      )
    )
      return;
    if (event.clientX >= window.innerWidth / 2) goNext();
    else goPrevious();
  };

  return (
    <div
      className="info-story-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} information`}
      onClick={handleHalfClick}
    >
      <div className="info-story-orb" />
      <div
        className="info-story-progress"
        aria-label={`Page ${pageIndex + 1} of ${pages.length}`}
      >
        {pages.map((page, index) => (
          <span
            className={
              index === pageIndex ? "active" : index < pageIndex ? "passed" : ""
            }
            key={page.key}
          />
        ))}
      </div>
      <FocusableButton
        className="info-story-close"
        onClick={onClose}
        focusKey="STORY_CLOSE"
        title="Close"
      >
        <LuX size={24} />
      </FocusableButton>

      {!data ? (
        <div className="info-story-state">
          {isFetching ? (
            <LuLoaderCircle className="spin" size={58} />
          ) : (
            <>
              <LuBookOpen size={54} />
              <h1>Story unavailable</h1>
              <p>
                {error instanceof Error
                  ? error.message
                  : "Metadata could not be loaded."}
              </p>
              <FocusableButton
                className="content-primary-button"
                onClick={() => void refetch()}
              >
                <LuRefreshCw size={18} /> Try again
              </FocusableButton>
            </>
          )}
        </div>
      ) : currentPage.key === "about" ? (
        <AboutPage
          data={data}
          title={title}
          description={description}
          backdrops={backdrops}
          backdropIndex={backdropIndex}
        />
      ) : currentPage.key === "trailer" ? (
        <TrailerPage data={data} />
      ) : currentPage.key === "cast" ? (
        <CastPage data={data} />
      ) : currentPage.key === "boxoffice" ? (
        <BoxOfficePage data={data} />
      ) : currentPage.key === "ratings" ? (
        <RatingsPage data={data} />
      ) : currentPage.key === "facts" ? (
        <FactsPage data={data} facts={facts} />
      ) : currentPage.key === "related" ? (
        <RelatedPage data={data} />
      ) : (
        <CollectionPage data={data} />
      )}

      {data && (
        <nav className="info-story-navigation" aria-label="Story pages">
          <FocusableButton
            className="info-story-nav-button"
            disabled={pageIndex === 0}
            focusKey="STORY_PREVIOUS"
            onClick={goPrevious}
            title="Previous page"
          >
            <LuChevronLeft size={26} />
          </FocusableButton>
          <div className="info-story-page-label">
            <strong>{currentPage.label}</strong>
            <span>
              {pageIndex + 1} / {pages.length}
            </span>
          </div>
          <FocusableButton
            className="info-story-nav-button"
            disabled={pageIndex === pages.length - 1}
            focusKey="STORY_NEXT"
            onClick={goNext}
            title="Next page"
          >
            <LuChevronRight size={26} />
          </FocusableButton>
        </nav>
      )}
    </div>
  );
}

function AboutPage({
  data,
  title,
  description,
  backdrops,
  backdropIndex,
}: {
  data: any;
  title: string;
  description?: string;
  backdrops: string[];
  backdropIndex: number;
}) {
  return (
    <div className="info-story-content">
      <div className="info-story-visual">
        {backdrops[backdropIndex] ? (
          <img
            key={backdrops[backdropIndex]}
            className="info-story-backdrop"
            src={backdrops[backdropIndex]}
            alt=""
          />
        ) : (
          <div className="info-story-backdrop-placeholder" />
        )}
        <div>
          <h1>{data.title || title}</h1>
          {data.tagline && <p className="info-story-tagline">{data.tagline}</p>}
          {formatRating(data.rating) && (
            <div className="info-story-about-badges">
              <span className="info-story-badge info-story-badge-imdb">
                <LuStar size={14} /> {formatRating(data.rating)}
                {data.voteCount ? ` (${compactNumber(data.voteCount)})` : ""}
              </span>
              {data.metascore && (
                <span className="info-story-badge info-story-badge-meta">
                  {data.metascore}
                </span>
              )}
              {data.meterRank && (
                <span className="info-story-badge info-story-badge-rank">
                  <LuTrendingUp size={13} /> #{data.meterRank}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="info-story-details">
        <section className="info-story-section info-story-about">
          <h2>
            <LuClapperboard size={25} /> What's it about
          </h2>
          <p>{data.overview || description || "No overview is available."}</p>
        </section>
      </div>
    </div>
  );
}

function TrailerPage({ data }: { data: any }) {
  const [trailerIndex, setTrailerIndex] = useState(0);
  const trailers = useMemo(() => {
    if (data.trailers && data.trailers.length > 0) return data.trailers;
    if (data.trailerUrl)
      return [
        {
          id: "1",
          name: data.trailerName,
          url: data.trailerUrl,
          thumbnail: data.trailerThumbnail,
        },
      ];
    if (data.trailerKey)
      return [{ id: "1", name: data.trailerName, youtubeKey: data.trailerKey }];
    return [];
  }, [
    data.trailers,
    data.trailerUrl,
    data.trailerName,
    data.trailerThumbnail,
    data.trailerKey,
  ]);

  const activeVideo =
    trailers[Math.min(trailerIndex, trailers.length - 1)] || trailers[0];

  const goPrevTrailer = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setTrailerIndex((idx) => (idx > 0 ? idx - 1 : trailers.length - 1));
  };

  const goNextTrailer = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setTrailerIndex((idx) => (idx < trailers.length - 1 ? idx + 1 : 0));
  };

  return (
    <div className="info-story-single-page info-story-trailer-page">
      <header className="info-story-page-heading">
        <LuPlay size={30} />
        <div>
          <span>{data.title}</span>
          <h1>
            {trailers.length > 1
              ? `Trailer (${trailerIndex + 1}/${trailers.length})`
              : "Trailer"}
          </h1>
        </div>
      </header>
      <div className="info-story-trailer-player-container">
        {trailers.length > 1 && (
          <FocusableButton
            className="info-story-trailer-side-btn info-story-trailer-prev"
            onClick={goPrevTrailer}
            focusKey="TRAILER_PREV"
            title="Previous trailer"
          >
            <LuChevronLeft size={24} />
          </FocusableButton>
        )}

        <div className="info-story-video">
          {activeVideo?.url ? (
            <video
              key={activeVideo.url}
              src={activeVideo.url}
              poster={activeVideo.thumbnail}
              controls
              playsInline
            />
          ) : activeVideo?.youtubeKey ? (
            <iframe
              key={activeVideo.youtubeKey}
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(activeVideo.youtubeKey)}?playsinline=1&rel=0&modestbranding=1&enablejsapi=1`}
              title={activeVideo.name || `${data.title} trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : null}
        </div>

        {trailers.length > 1 && (
          <FocusableButton
            className="info-story-trailer-side-btn info-story-trailer-next"
            onClick={goNextTrailer}
            focusKey="TRAILER_NEXT"
            title="Next trailer"
          >
            <LuChevronRight size={24} />
          </FocusableButton>
        )}
      </div>
      <div className="info-story-trailer-footer">
        <strong>
          {activeVideo?.name || data.trailerName || `${data.title} trailer`}
        </strong>
        {activeVideo?.youtubeKey && (
          <FocusableButton
            className="info-story-youtube"
            onClick={() =>
              void openUrl(
                `https://www.youtube.com/watch?v=${encodeURIComponent(activeVideo.youtubeKey || "")}`,
              )
            }
          >
            Open in YouTube
          </FocusableButton>
        )}
      </div>
    </div>
  );
}

function CastPage({ data }: { data: any }) {
  const handlePersonClick = (person: any) => {
    if (!person.id) return;
    const idStr = String(person.id);
    if (idStr.startsWith("nm")) {
      void openUrl(`https://www.imdb.com/name/${idStr}/`);
    } else {
      void openUrl(`https://www.themoviedb.org/person/${idStr}`);
    }
  };

  return (
    <div className="info-story-single-page info-story-cast-page">
      <header className="info-story-page-heading">
        <LuUsers size={30} />
        <div>
          <span>{data.title}</span>
          <h1>Cast</h1>
        </div>
      </header>
      <div className="info-story-cast-grid">
        {data.cast.slice(0, 12).map((person: any) => (
          <article
            className="info-story-cast-card"
            key={person.id}
            onClick={() => handlePersonClick(person)}
            role="button"
            tabIndex={0}
            title={`Open ${person.name} on IMDb`}
          >
            <div className="info-story-cast-poster-wrap">
              {tmdbImageUrl(person.profilePath, "w342") ? (
                <img
                  src={tmdbImageUrl(person.profilePath, "w342")}
                  alt={person.name}
                />
              ) : (
                <div className="info-story-person-placeholder">
                  <LuUsers size={28} />
                </div>
              )}
            </div>
            <div className="info-story-cast-meta">
              <strong>{person.name}</strong>
              {person.character && <span>{person.character}</span>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function BoxOfficePage({ data }: { data: any }) {
  const stats = [
    { label: "Budget", value: data.productionBudget, icon: LuDollarSign },
    {
      label: "Opening Weekend",
      value: data.openingWeekendGross,
      icon: LuCalendar,
    },
    { label: "Domestic", value: data.domesticGross, icon: LuChartBar },
    { label: "Worldwide", value: data.worldwideGross, icon: LuGlobe },
  ].filter((s) => s.value);

  const maxValue = Math.max(...stats.map((s) => s.value || 0));

  return (
    <div className="info-story-single-page">
      <header className="info-story-page-heading">
        <LuDollarSign size={30} />
        <div>
          <span>{data.title}</span>
          <h1>Box Office</h1>
        </div>
      </header>
      <div className="info-story-boxoffice">
        {stats.map(({ label, value, icon: Icon }) => {
          const pct = maxValue > 0 ? Math.round((value / maxValue) * 100) : 0;
          return (
            <div className="info-story-boxoffice-row" key={label}>
              <div className="info-story-boxoffice-label">
                <Icon size={18} />
                <span>{label}</span>
              </div>
              <div className="info-story-boxoffice-bar-track">
                <div
                  className="info-story-boxoffice-bar-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <strong className="info-story-boxoffice-value">
                {formatCurrency(value)}
              </strong>
            </div>
          );
        })}
      </div>
      {data.productionBudget &&
        data.worldwideGross &&
        (() => {
          const roi = (data.worldwideGross / data.productionBudget) * 100 - 100;
          const isProfit = roi >= 0;
          return (
            <div className="info-story-boxoffice-roi">
              <span>Return on Investment</span>
              <strong style={{ color: isProfit ? "#22c55e" : "#ef4444" }}>
                {isProfit ? `+${roi.toFixed(0)}%` : `${roi.toFixed(0)}%`}
              </strong>
            </div>
          );
        })()}
    </div>
  );
}

function RatingsPage({ data }: { data: any }) {
  const [isReviewExpanded, setIsReviewExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const reviewTextRef = useRef<HTMLParagraphElement>(null);
  const histogram = data.ratingsHistogram ?? [];
  const maxVotes = Math.max(...histogram.map((h: any) => h.voteCount));

  useEffect(() => {
    if (reviewTextRef.current) {
      const el = reviewTextRef.current;
      setIsOverflowing(el.scrollHeight > el.clientHeight + 4);
    }
  }, [data.featuredReview?.text]);

  const hasReview = Boolean(
    data.featuredReview?.text || data.featuredReview?.summary,
  );

  return (
    <div
      className={`info-story-single-page ${hasReview ? "info-story-ratings-page" : ""}`}
    >
      <header className="info-story-page-heading">
        <LuChartBar size={30} />
        <div>
          <span>{data.title}</span>
          <h1>User reviews</h1>
        </div>
      </header>
      <div className="info-story-ratings-content">
        <div className="info-story-ratings-layout">
          <div className="info-story-ratings-top">
            <div className="info-story-ratings-big">
              <LuStar size={44} />
              <strong>{formatRating(data.rating)}</strong>
            </div>
            <span className="info-story-ratings-count">
              {compactNumber(data.voteCount)}
            </span>
          </div>
          <div className="info-story-histogram">
            {histogram.map((entry: any) => {
              const pct = maxVotes > 0 ? (entry.voteCount / maxVotes) * 100 : 0;
              return (
                <div className="info-story-histogram-col" key={entry.rating}>
                  <div className="info-story-histogram-track">
                    <div
                      className="info-story-histogram-fill"
                      style={{ height: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <span className="info-story-histogram-label">
                    {entry.rating}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {data.featuredReview && (
          <div className="info-story-featured-review">
            <h3>Featured Review</h3>
            {data.featuredReview.rating && (
              <div className="info-story-featured-review-rating">
                <LuStar size={16} fill="currentColor" />{" "}
                {data.featuredReview.rating}/10
              </div>
            )}
            {data.featuredReview.summary && (
              <strong>{data.featuredReview.summary}</strong>
            )}
            <p
              ref={reviewTextRef}
              className={
                isReviewExpanded ? "info-story-featured-review-expanded" : ""
              }
            >
              {data.featuredReview.text}
            </p>
            {(isOverflowing || isReviewExpanded) && (
              <button
                className="info-story-review-toggle"
                onClick={() => setIsReviewExpanded((p) => !p)}
              >
                {isReviewExpanded ? "Show less" : "Read more"}
              </button>
            )}
            <span className="info-story-featured-review-author">
              By {data.featuredReview.author} • {data.featuredReview.date}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function FactsPage({ data, facts }: { data: any; facts: StoryFact[] }) {
  return (
    <div className="info-story-single-page info-story-facts-page">
      <header className="info-story-page-heading">
        <LuChartNoAxesCombined size={30} />
        <div>
          <span>{data.title}</span>
          <h1>Ratings & facts</h1>
        </div>
      </header>
      <div className="info-story-facts info-story-facts-large">
        {facts.map(({ icon: Icon, label, value }) => (
          <div className="info-story-fact" key={`${label}-${value}`}>
            <Icon size={24} />
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="info-story-fact-columns">
        {data.creators?.length > 0 && (
          <section>
            <h2>{data.mediaType === "tv" ? "Created by" : "Directed by"}</h2>
            <p>{data.creators.join(" · ")}</p>
          </section>
        )}
        {(data.networks?.length > 0 || data.companies?.length > 0) && (
          <section>
            <h2>Production</h2>
            <p>
              {[...(data.networks ?? []), ...(data.companies ?? [])].join(
                " · ",
              )}
            </p>
          </section>
        )}
        {data.awardsText && (
          <section>
            <h2>Awards</h2>
            <p>{data.awardsText}</p>
          </section>
        )}
      </div>
      <div className="info-story-chips">
        {[...data.genres, ...data.keywords].slice(0, 12).map((item: string) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function RelatedPage({ data }: { data: any }) {
  const titles = data.relatedTitles ?? [];

  const handleTitleClick = (title: any) => {
    if (!title.id) return;
    const idStr = String(title.id);
    if (idStr.startsWith("tt")) {
      void openUrl(`https://www.imdb.com/title/${idStr}/`);
    } else {
      const type = title.mediaType || "movie";
      void openUrl(`https://www.themoviedb.org/${type}/${idStr}`);
    }
  };

  return (
    <div className="info-story-single-page info-story-related-page">
      <header className="info-story-page-heading">
        <LuFilm size={30} />
        <div>
          <span>{data.title}</span>
          <h1>Recommendations</h1>
        </div>
      </header>
      <div className="info-story-related-grid">
        {titles.slice(0, 12).map((title: any) => (
          <article
            className="info-story-related-card"
            key={title.id}
            onClick={() => handleTitleClick(title)}
            role="button"
            tabIndex={0}
            title={`Open ${title.title} on IMDb`}
          >
            <div className="info-story-related-poster-wrap">
              {title.image ? (
                <img src={title.image} alt={title.title} />
              ) : (
                <div className="info-story-poster-placeholder">
                  <LuFilm size={28} />
                </div>
              )}
            </div>
            <div className="info-story-related-meta">
              <strong>{title.title}</strong>
              {formatRating(title.rating) && (
                <div className="info-story-related-rating">
                  <LuStar size={12} fill="#f5c518" color="#f5c518" />
                  <span>{formatRating(title.rating)}</span>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function CollectionPage({ data }: { data: any }) {
  const items = data.collectionItems ?? [];
  return (
    <div className="info-story-single-page info-story-collection-page">
      <header className="info-story-page-heading">
        {data.mediaType === "tv" ? <LuTv size={30} /> : <LuFilm size={30} />}
        <div>
          <span>{data.title}</span>
          <h1>
            {data.collectionTitle ||
              (data.mediaType === "tv" ? "Seasons" : "Collection")}
          </h1>
        </div>
      </header>
      <div className="info-story-collection-grid">
        {items.slice(0, 12).map((item: any) => {
          const img =
            tmdbImageUrl(item.imagePath, "w342") ||
            (item.imagePath?.startsWith("http") ? item.imagePath : undefined);
          return (
            <article className="info-story-collection-card" key={item.id}>
              <div className="info-story-collection-poster-wrap">
                {img ? (
                  <img src={img} alt={item.title} />
                ) : (
                  <div className="info-story-poster-placeholder">
                    <LuFilm size={28} />
                  </div>
                )}
              </div>
              <div className="info-story-collection-meta">
                <strong>{item.title}</strong>
                {item.subtitle && <span>{item.subtitle}</span>}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

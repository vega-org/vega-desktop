import { useEffect, useMemo, useState, type ComponentType, type MouseEvent as ReactMouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  LuBookOpen,
  LuCalendar,
  LuChartNoAxesCombined,
  LuChevronLeft,
  LuChevronRight,
  LuClapperboard,
  LuClock3,
  LuFilm,
  LuInfo,
  LuLoaderCircle,
  LuPlay,
  LuRefreshCw,
  LuStar,
  LuTrendingUp,
  LuTv,
  LuUsers,
  LuX,
  LuYoutube,
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
  key: "about" | "trailer" | "cast" | "facts" | "collection";
  label: string;
}

interface StoryFact {
  icon: ComponentType<{ size?: number }>;
  label: string;
  value: string;
}

const imageUrl = (path?: string, size: "w342" | "w780" | "original" = "w780") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;

const formatRuntime = (minutes?: number) => {
  if (!minutes) return undefined;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h ${remaining}m` : `${remaining}m`;
};

const compactNumber = (value?: number) =>
  value ? new Intl.NumberFormat("en", { notation: "compact" }).format(value) : undefined;

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
  const { data, error, isFetching, refetch } = useTmdbStory({ enabled: open, imdbId, tmdbId, type });
  const pages = useMemo<StoryPage[]>(() => {
    const result: StoryPage[] = [{ key: "about", label: "About" }];
    if (data?.trailerKey) result.push({ key: "trailer", label: "Trailer" });
    if (data?.cast.length) result.push({ key: "cast", label: "Cast" });
    result.push({ key: "facts", label: "Facts" });
    if (data?.collectionItems.length) {
      result.push({ key: "collection", label: data.mediaType === "tv" ? "Seasons" : "Collection" });
    }
    return result;
  }, [data]);
  const currentPage = pages[Math.min(pageIndex, pages.length - 1)];
  const backdrops = useMemo(
    () => Array.from(new Set([...(data?.backdropPaths ?? []).map((path) => imageUrl(path, "original")), backdrop].filter(Boolean))) as string[],
    [backdrop, data?.backdropPaths],
  );

  useEffect(() => {
    if (open) setPageIndex(0);
  }, [open, data?.id]);

  useEffect(() => {
    setBackdropIndex(0);
    if (!open || backdrops.length < 2) return;
    const interval = window.setInterval(() => setBackdropIndex((index) => (index + 1) % backdrops.length), 5000);
    return () => window.clearInterval(interval);
  }, [backdrops, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") setPageIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight") setPageIndex((value) => Math.min(pages.length - 1, value + 1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, pages.length]);

  if (!open) return null;

  const facts = data ? [
    data.trendingRank ? { icon: LuTrendingUp, label: "Trending this week", value: `#${data.trendingRank}` } : null,
    data.rating ? { icon: LuStar, label: `${compactNumber(data.voteCount) || "TMDB"} votes`, value: `${data.rating.toFixed(1)}/10` } : null,
    data.certification ? { icon: LuInfo, label: "Content rating", value: data.certification } : null,
    data.releaseDate ? { icon: LuCalendar, label: "Released", value: data.releaseDate.slice(0, 4) } : null,
    data.runtime ? { icon: LuClock3, label: data.mediaType === "tv" ? "Episode runtime" : "Runtime", value: formatRuntime(data.runtime)! } : null,
    data.status ? { icon: LuInfo, label: "Status", value: data.status } : null,
  ].filter(Boolean) as StoryFact[] : [];

  const goPrevious = () => setPageIndex((value) => Math.max(0, value - 1));
  const goNext = () => setPageIndex((value) => Math.min(pages.length - 1, value + 1));
  const handleHalfClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[role='button'], button, a, iframe, input, select, textarea, .info-story-navigation, .info-story-video")) return;
    if (event.clientX >= window.innerWidth / 2) goNext();
    else goPrevious();
  };

  return (
    <div className="info-story-dialog" role="dialog" aria-modal="true" aria-label={`${title} information`} onClick={handleHalfClick}>
      <div className="info-story-orb" />
      <div className="info-story-progress" aria-label={`Page ${pageIndex + 1} of ${pages.length}`}>
        {pages.map((page, index) => <span className={index === pageIndex ? "active" : index < pageIndex ? "passed" : ""} key={page.key} />)}
      </div>
      <FocusableButton className="info-story-close" onClick={onClose} focusKey="STORY_CLOSE" title="Close"><LuX size={34} /></FocusableButton>

      {!data ? (
        <div className="info-story-state">
          {isFetching ? (
            <LuLoaderCircle className="spin" size={58} />
          ) : (
            <>
              <LuBookOpen size={54} />
              <h1>Story unavailable</h1>
              <p>{error instanceof Error ? error.message : "TMDB metadata could not be loaded."}</p>
              <FocusableButton className="content-primary-button" onClick={() => void refetch()}><LuRefreshCw size={18} /> Try again</FocusableButton>
            </>
          )}
        </div>
      ) : currentPage.key === "about" ? (
        <div className="info-story-content">
          <div className="info-story-visual">
            {backdrops[backdropIndex] ? <img key={backdrops[backdropIndex]} className="info-story-backdrop" src={backdrops[backdropIndex]} alt="" /> : <div className="info-story-backdrop-placeholder" />}
            <div><h1>{data.title || title}</h1>{data.tagline && <p className="info-story-tagline">{data.tagline}</p>}</div>
          </div>
          <div className="info-story-details">
            <section className="info-story-section info-story-about">
              <h2><LuClapperboard size={25} /> What's it about</h2>
              <p>{data.overview || description || "No overview is available."}</p>
            </section>
          </div>
        </div>
      ) : currentPage.key === "trailer" ? (
        <div className="info-story-single-page info-story-trailer-page">
          <header className="info-story-page-heading"><LuPlay size={30} /><div><span>{data.title}</span><h1>Trailer</h1></div></header>
          <div className="info-story-video">
            <iframe
              src={`https://www.youtube.com/embed/${encodeURIComponent(data.trailerKey || "")}?playsinline=1&rel=0&modestbranding=1`}
              title={data.trailerName || `${data.title} trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <div className="info-story-trailer-footer">
            <strong>{data.trailerName || `${data.title} trailer`}</strong>
            <FocusableButton className="info-story-youtube" onClick={() => void openUrl(`https://www.youtube.com/watch?v=${encodeURIComponent(data.trailerKey || "")}`)}>
              <LuYoutube size={24} /> Open in YouTube
            </FocusableButton>
          </div>
        </div>
      ) : currentPage.key === "cast" ? (
        <div className="info-story-single-page">
          <header className="info-story-page-heading"><LuUsers size={30} /><div><span>{data.title}</span><h1>Cast</h1></div></header>
          <div className="info-story-cast-grid">
            {data.cast.slice(0, 8).map((person) => (
              <article className="info-story-cast-card" key={person.id}>
                {imageUrl(person.profilePath, "w342") ? <img src={imageUrl(person.profilePath, "w342")} alt="" /> : <div className="info-story-person-placeholder"><LuUsers size={34} /></div>}
                <div><strong>{person.name}</strong>{person.character && <span>{person.character}</span>}</div>
              </article>
            ))}
          </div>
        </div>
      ) : currentPage.key === "facts" ? (
        <div className="info-story-single-page info-story-facts-page">
          <header className="info-story-page-heading"><LuChartNoAxesCombined size={30} /><div><span>{data.title}</span><h1>Ratings & facts</h1></div></header>
          <div className="info-story-facts info-story-facts-large">
            {facts.map(({ icon: Icon, label, value }) => <div className="info-story-fact" key={`${label}-${value}`}><Icon size={24} /><strong>{value}</strong><span>{label}</span></div>)}
          </div>
          <div className="info-story-fact-columns">
            <section><h2>{data.mediaType === "tv" ? "Created by" : "Directed by"}</h2><p>{data.creators.join(" · ") || "Unknown"}</p></section>
            <section><h2>Production</h2><p>{[...data.networks, ...data.companies].join(" · ") || "Unknown"}</p></section>
          </div>
          <div className="info-story-chips">{[...data.genres, ...data.keywords].slice(0, 12).map((item) => <span key={item}>{item}</span>)}</div>
        </div>
      ) : (
        <div className="info-story-single-page">
          <header className="info-story-page-heading">{data.mediaType === "tv" ? <LuTv size={30} /> : <LuFilm size={30} />}<div><span>{data.title}</span><h1>{data.collectionTitle || (data.mediaType === "tv" ? "Seasons" : "Collection")}</h1></div></header>
          <div className="info-story-collection-grid">
            {data.collectionItems.slice(0, 8).map((item) => (
              <article className="info-story-collection-card" key={item.id}>
                {imageUrl(item.imagePath, "w342") ? <img src={imageUrl(item.imagePath, "w342")} alt="" /> : <div className="info-story-poster-placeholder"><LuFilm size={32} /></div>}
                <div><strong>{item.title}</strong>{item.subtitle && <span>{item.subtitle}</span>}</div>
              </article>
            ))}
          </div>
        </div>
      )}

      {data && (
        <nav className="info-story-navigation" aria-label="Story pages">
          <FocusableButton className="info-story-nav-button" disabled={pageIndex === 0} focusKey="STORY_PREVIOUS" onClick={goPrevious} title="Previous page"><LuChevronLeft size={26} /></FocusableButton>
          <div className="info-story-page-label"><strong>{currentPage.label}</strong><span>{pageIndex + 1} / {pages.length}</span></div>
          <FocusableButton className="info-story-nav-button" disabled={pageIndex === pages.length - 1} focusKey="STORY_NEXT" onClick={goNext} title="Next page"><LuChevronRight size={26} /></FocusableButton>
        </nav>
      )}
    </div>
  );
}

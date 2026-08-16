import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { settingsStorage } from "../storage";

export type TmdbMediaType = "movie" | "tv";

export interface TmdbStoryCastMember {
  id: number | string;
  name: string;
  character?: string;
  profilePath?: string;
}

export interface TmdbStoryCollectionItem {
  id: number | string;
  title: string;
  subtitle?: string;
  imagePath?: string;
}

export interface RatingHistogramEntry {
  rating: number;
  voteCount: number;
}

export interface FeaturedReview {
  author?: string;
  summary?: string;
  text?: string;
  rating?: number;
  date?: string;
}

export interface RelatedTitle {
  id: string | number;
  title: string;
  image?: string;
  rating?: number;
  voteCount?: number;
  mediaType?: TmdbMediaType;
}

export interface StoryVideo {
  id: string | number;
  name?: string;
  url?: string;
  thumbnail?: string;
  youtubeKey?: string;
}

export interface TmdbStoryData {
  id: number | string;
  mediaType: TmdbMediaType;
  title: string;
  tagline?: string;
  overview?: string;
  backdropPaths: string[];
  posterPath?: string;
  trailerKey?: string;
  trailerName?: string;
  trailerUrl?: string;
  trailerThumbnail?: string;
  trailers?: StoryVideo[];
  releaseDate?: string;
  runtime?: number;
  genres: string[];
  rating?: number;
  voteCount?: number;
  popularity?: number;
  trendingRank?: number;
  meterRank?: number;
  certification?: string;
  status?: string;
  originalLanguage?: string;
  cast: TmdbStoryCastMember[];
  creators: string[];
  companies: string[];
  countries: string[];
  networks: string[];
  keywords: string[];
  collectionTitle?: string;
  collectionItems: TmdbStoryCollectionItem[];
  metascore?: number;
  productionBudget?: number;
  openingWeekendGross?: number;
  domesticGross?: number;
  worldwideGross?: number;
  ratingsHistogram?: RatingHistogramEntry[];
  featuredReview?: FeaturedReview;
  relatedTitles?: RelatedTitle[];
  watchlistCount?: string;
  awardsText?: string;
  totalSeasons?: number;
  totalEpisodes?: number;
  upcomingSeason?: string;
}

interface UseTmdbStoryOptions {
  enabled: boolean;
  imdbId?: string;
  tmdbId?: number | string;
  type?: string;
}

const TMDB_API_URL = "https://api.themoviedb.org/3";
export const getProxyApiUrl = () =>
  String(import.meta.env.VITE_PROXY_API_URL || import.meta.env.VITE_META_PROXY_URL || "").trim();

export const getTmdbApiKey = () =>
  settingsStorage.getTmdbApiKey() || String(import.meta.env.VITE_TMDB_API_KEY || "").trim();

const preferredType = (type?: string): TmdbMediaType =>
  type?.toLowerCase() === "series" || type?.toLowerCase() === "tv" ? "tv" : "movie";

const certification = (details: any, mediaType: TmdbMediaType) => {
  if (mediaType === "tv") {
    const ratings = details.content_ratings?.results ?? [];
    return (ratings.find((item: any) => item.iso_3166_1 === "US") ?? ratings[0])?.rating?.trim();
  }
  const releases = details.release_dates?.results ?? [];
  const country = releases.find((item: any) => item.iso_3166_1 === "US") ?? releases[0];
  return country?.release_dates?.find((item: any) => item.certification)?.certification?.trim();
};

const imageUrl = (path?: string) =>
  path ? `https://image.tmdb.org/t/p/w780${path}` : undefined;

function parseProxyResponse(json: any): TmdbStoryData | null {
  if (!json?.success) return null;

  const raw = json.raw;
  const aboveTheFold = raw?.aboveTheFoldData;
  const mainColumn = raw?.mainColumnData;

  const isTv = json.type === "tvSeries" || json.type === "tvMiniSeries" || json.isSeries === true;
  const mediaType: TmdbMediaType = isTv ? "tv" : "movie";

  const primaryVideos = (aboveTheFold?.primaryVideos?.edges?.map((e: any) => e.node) ?? aboveTheFold?.primaryVideos ?? []) as any[];
  const trailersList: StoryVideo[] = [];
  primaryVideos.forEach((v: any, index: number) => {
    const playUrl = v.playbackURLs?.find((p: any) =>
      p.url?.endsWith(".mp4") || p.mimeType?.includes("mp4") || p.videoMimeType?.includes("mp4")
    )?.url ?? v.playbackURLs?.[0]?.url;
    if (playUrl) {
      trailersList.push({
        id: v.id || `video-${index}`,
        name: v.name?.value,
        url: playUrl,
        thumbnail: v.thumbnail?.url,
      });
    }
  });

  const trailer = aboveTheFold?.primaryVideos?.edges?.[0]?.node ?? aboveTheFold?.primaryVideos?.[0];
  const trailerPlayback = trailer?.playbackURLs?.find((p: any) =>
    p.url?.endsWith(".mp4") || p.mimeType?.includes("mp4") || p.videoMimeType?.includes("mp4")
  ) ?? trailer?.playbackURLs?.[0];

  if (trailersList.length === 0 && (trailerPlayback?.url || trailer?.name?.value)) {
    trailersList.push({
      id: "primary-trailer",
      name: trailer?.name?.value,
      url: trailerPlayback?.url,
      thumbnail: trailer?.thumbnail?.url,
    });
  }

  const histogram = mainColumn?.aggregateRatingsBreakdown?.histogram?.histogramValues;
  const meterRanking = aboveTheFold?.meterRanking;
  const engagementStats = aboveTheFold?.engagementStatistics;
  const awards = mainColumn?.prestigiousAwardSummary;

  const rawCastV2 = mainColumn?.castV2;
  const castCredits: any[] = Array.isArray(rawCastV2)
    ? rawCastV2.flatMap((group: any) => group.credits ?? [])
    : (rawCastV2?.credits ?? rawCastV2?.edges ?? []);

  const cast: TmdbStoryCastMember[] = castCredits.slice(0, 24).map((credit: any) => {
    const person = credit.name ?? credit.node?.name ?? credit;
    const character = credit.creditedRoles?.[0]?.characters?.[0]?.name
      ?? credit.characters?.[0]
      ?? credit.character;
    return {
      id: person.id,
      name: person.nameText ?? person.name,
      character: character || undefined,
      profilePath: person.primaryImage?.url || undefined,
    };
  });

  if (cast.length === 0) {
    (json.cast ?? []).slice(0, 24).forEach((person: any) => {
      cast.push({
        id: person.id,
        name: person.name,
        character: person.characters?.[0] || undefined,
        profilePath: undefined,
      });
    });
  }

  const featuredReviews = aboveTheFold?.featuredReviews?.edges ?? (Array.isArray(aboveTheFold?.featuredReviews) ? aboveTheFold.featuredReviews : []);
  const review = featuredReviews[0]?.node ?? featuredReviews[0];
  const featuredReview = review ? {
    author: review.author?.nickName || review.author?.displayName || undefined,
    summary: review.summary?.originalText || undefined,
    text: review.text?.originalText || undefined,
    rating: review.authorRating || undefined,
    date: review.submissionDate || undefined,
  } : undefined;

  const principalCredits = mainColumn?.principalCredits ?? [];
  const creatorGroup = principalCredits.find((c: any) =>
    ["creator", "director", "writer"].includes(c.category?.id)
  );
  const creatorsFromPrincipal = (creatorGroup?.credits ?? [])
    .map((c: any) => c.name?.nameText || c.name?.name)
    .filter(Boolean);

  const legacyDirectors = json.credits?.director ?? json.credits?.creator ?? [];
  const creators = (creatorsFromPrincipal.length > 0
    ? creatorsFromPrincipal
    : legacyDirectors.map((d: any) => d.name)
  ).filter(Boolean);

  const stars = json.credits?.stars ?? [];

  if (cast.length === 0 && stars.length > 0) {
    stars.forEach((s: any) => {
      cast.push({ id: s.id, name: s.name, profilePath: undefined });
    });
  }

  const episodes = mainColumn?.episodes;
  const currentYear = new Date().getFullYear();
  const years = (episodes?.years ?? []).map((y: any) => y.year).filter(Boolean);
  const futureYears = years.filter((y: number) => y > currentYear);
  const spotlightSeason = parseInt(episodes?.episodeSpotlight?.[0]?.series?.displayableEpisodeNumber?.displayableSeason?.season, 10);
  const totalRawSeasons = episodes?.seasons?.length ?? episodes?.displayableSeasons?.length ?? 0;

  let totalSeasons: number | undefined;
  let upcomingSeason: string | undefined;

  if (isTv) {
    if (json.type === "tvMiniSeries") {
      totalSeasons = 1;
    } else if (spotlightSeason && spotlightSeason > 0 && spotlightSeason <= totalRawSeasons) {
      totalSeasons = spotlightSeason;
      if (totalRawSeasons > spotlightSeason && futureYears.length > 0) {
        const nextSeasonNum = spotlightSeason + 1;
        const nextYear = futureYears[0];
        upcomingSeason = `Season ${nextSeasonNum} (${nextYear})`;
      }
    } else if (futureYears.length > 0 && totalRawSeasons > 1) {
      const futureSeasonsCount = futureYears.length;
      totalSeasons = Math.max(1, totalRawSeasons - futureSeasonsCount);
      const nextSeasonNum = totalSeasons + 1;
      const nextYear = futureYears[0];
      upcomingSeason = `Season ${nextSeasonNum} (${nextYear})`;
    } else {
      totalSeasons = totalRawSeasons || undefined;
    }
  }
  const totalEpisodes = episodes?.totalEpisodes?.total || episodes?.episodes?.total || undefined;

  let awardsText: string | undefined;
  if (awards) {
    const parts: string[] = [];
    if (awards.wins) parts.push(`${awards.wins} wins`);
    if (awards.nominations) parts.push(`${awards.nominations} nominations`);
    if (awards.award?.text) parts.push(awards.award.text);
    awardsText = parts.join(" · ") || undefined;
  }

  const collectionItems: TmdbStoryCollectionItem[] = [];

  return {
    id: json.id,
    mediaType,
    title: json.title || json.originalTitle || "",
    tagline: undefined,
    overview: json.plot || undefined,
    backdropPaths: (mainColumn?.titleMainImages ?? [])
      .filter((img: any) => img.url && img.width && img.height && img.width / img.height >= 1.25)
      .map((img: any) => img.url),
    posterPath: json.poster?.url || undefined,
    trailerKey: undefined,
    trailerName: trailersList[0]?.name || undefined,
    trailerUrl: trailersList[0]?.url || undefined,
    trailerThumbnail: trailersList[0]?.thumbnail || undefined,
    trailers: trailersList,
    releaseDate: json.releaseDate || undefined,
    runtime: json.runtimeSeconds ? Math.round(json.runtimeSeconds / 60) : undefined,
    genres: json.genres ?? [],
    rating: json.rating || undefined,
    voteCount: json.voteCount || undefined,
    popularity: undefined,
    trendingRank: undefined,
    meterRank: meterRanking?.currentRank || undefined,
    certification: json.certificate || undefined,
    status: aboveTheFold?.productionStatus?.currentProductionStage?.text || undefined,
    originalLanguage: undefined,
    cast,
    creators: creators.slice(0, 5),
    companies: [],
    countries: [],
    networks: [],
    keywords: json.keywords ?? [],
    collectionTitle: isTv ? "Seasons" : undefined,
    collectionItems,
    metascore: json.metascore || undefined,
    productionBudget: mainColumn?.productionBudget?.budget?.amount || undefined,
    openingWeekendGross: mainColumn?.openingWeekendGross?.gross?.total?.amount || undefined,
    domesticGross: mainColumn?.lifetimeGross?.total?.amount || undefined,
    worldwideGross: mainColumn?.worldwideGross?.total?.amount || undefined,
    ratingsHistogram: histogram
      ? histogram.map((h: any) => ({ rating: h.rating, voteCount: h.voteCount }))
      : undefined,
    featuredReview,
    relatedTitles: json.raw.mainColumnData?.moreLikeThisTitles
      ? json.raw.mainColumnData.moreLikeThisTitles.map((t: any) => ({
          id: t.id,
          title: t.titleText || t.originalTitleText,
          image: t.primaryImage?.url || undefined,
          rating: t.ratingsSummary?.aggregateRating || undefined,
          voteCount: t.ratingsSummary?.voteCount || undefined,
          mediaType: t.titleType?.id === "tvSeries" ? "tv" : "movie",
        }))
      : undefined,
    watchlistCount: engagementStats?.watchlistStatistics?.displayableCount || undefined,
    awardsText,
    totalSeasons,
    totalEpisodes,
    upcomingSeason,
  };
}

async function fetchProxyStory(imdbId: string, signal?: AbortSignal): Promise<TmdbStoryData | null> {
  const proxyUrl = getProxyApiUrl();
  if (!proxyUrl) return null;

  try {
    const response = await axios.get(proxyUrl, {
      params: { url: imdbId },
      signal,
      timeout: 15000,
    });
    return parseProxyResponse(response.data);
  } catch (e) {
    console.warn("[Story] Proxy API failed, will try TMDB fallback:", e);
    return null;
  }
}

async function resolveIdentity({ apiKey, imdbId, tmdbId, type, signal }: {
  apiKey: string;
  imdbId?: string;
  tmdbId?: number | string;
  type?: string;
  signal?: AbortSignal;
}) {
  const mediaType = preferredType(type);
  const directId = Number(tmdbId);
  if (Number.isFinite(directId) && directId > 0) return { id: directId, mediaType };
  if (!imdbId) throw new Error("No TMDB or IMDb identifier is available");

  const response = await axios.get(`${TMDB_API_URL}/find/${encodeURIComponent(imdbId)}`, {
    params: { api_key: apiKey, external_source: "imdb_id", language: "en-US" },
    signal,
    timeout: 10000,
  });
  const preferred = mediaType === "tv" ? response.data?.tv_results ?? [] : response.data?.movie_results ?? [];
  const fallback = mediaType === "tv" ? response.data?.movie_results ?? [] : response.data?.tv_results ?? [];
  const result = preferred[0] ?? fallback[0];
  if (!result?.id) throw new Error("TMDB could not match this IMDb identifier");
  return { id: result.id as number, mediaType: preferred[0] ? mediaType : mediaType === "tv" ? "movie" as const : "tv" as const };
}

async function fetchTmdbStory({ imdbId, signal, tmdbId, type }: Omit<UseTmdbStoryOptions, "enabled"> & { signal?: AbortSignal }): Promise<TmdbStoryData> {
  const apiKey = getTmdbApiKey();
  if (!apiKey) throw new Error("No TMDB API key is configured. Add one in Settings.");
  const identity = await resolveIdentity({ apiKey, imdbId, tmdbId, type, signal });
  const append = identity.mediaType === "tv"
    ? "aggregate_credits,content_ratings,keywords,images,videos,reviews,recommendations"
    : "credits,release_dates,keywords,images,videos,reviews,recommendations";
  const response = await axios.get(`${TMDB_API_URL}/${identity.mediaType}/${identity.id}`, {
    params: {
      api_key: apiKey,
      append_to_response: append,
      include_image_language: "en,null",
      language: "en-US",
    },
    signal,
    timeout: 12000,
  });
  const details = response.data;
  const [trendingResult, collectionResult] = await Promise.allSettled([
    axios.get(`${TMDB_API_URL}/trending/${identity.mediaType}/week`, {
      params: { api_key: apiKey, language: "en-US" }, signal, timeout: 10000,
    }),
    details.belongs_to_collection?.id
      ? axios.get(`${TMDB_API_URL}/collection/${details.belongs_to_collection.id}`, {
          params: { api_key: apiKey, language: "en-US" }, signal, timeout: 10000,
        })
      : Promise.resolve(undefined),
  ]);

  const isTv = identity.mediaType === "tv";
  const creditData = isTv ? details.aggregate_credits : details.credits;
  const videos = (details.videos?.results ?? []).filter((video: any) => video.site === "YouTube" && video.key);
  const trailerVideo = videos.find((video: any) => video.type === "Trailer" && video.official)
    ?? videos.find((video: any) => video.type === "Trailer")
    ?? videos.find((video: any) => video.type === "Teaser")
    ?? videos[0];
  const collection = collectionResult.status === "fulfilled" ? collectionResult.value?.data : undefined;
  const trending = trendingResult.status === "fulfilled" ? trendingResult.value.data?.results ?? [] : [];
  const rank = trending.findIndex((item: any) => item.id === details.id);
  const keywordItems = isTv ? details.keywords?.results ?? [] : details.keywords?.keywords ?? [];
  const crew = creditData?.crew ?? [];
  const creators = isTv
    ? (details.created_by ?? []).map((person: any) => person.name)
    : crew.filter((person: any) => person.job === "Director").map((person: any) => person.name);

  const tmdbReviews = details.reviews?.results ?? [];
  const review = tmdbReviews[0];
  const featuredReview = review ? {
    author: review.author || review.author_details?.username || undefined,
    summary: undefined,
    text: review.content || undefined,
    rating: review.author_details?.rating || undefined,
    date: review.created_at || undefined,
  } : undefined;

  const tmdbTrailers: StoryVideo[] = (details.videos?.results ?? [])
    .filter((v: any) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser" || v.type === "Clip"))
    .map((v: any) => ({
      id: v.id || v.key,
      name: v.name,
      youtubeKey: v.key,
    }));

  return {
    id: details.id,
    mediaType: identity.mediaType,
    title: details.title || details.name || "",
    tagline: details.tagline || undefined,
    overview: details.overview || undefined,
    backdropPaths: (details.images?.backdrops ?? []).slice(0, 8).map((item: any) => item.file_path).filter(Boolean),
    posterPath: imageUrl(details.poster_path) || undefined,
    trailerKey: trailerVideo?.key || tmdbTrailers[0]?.youtubeKey || undefined,
    trailerName: trailerVideo?.name || tmdbTrailers[0]?.name || undefined,
    trailerUrl: undefined,
    trailerThumbnail: undefined,
    trailers: tmdbTrailers,
    releaseDate: isTv ? details.first_air_date : details.release_date,
    runtime: isTv ? details.episode_run_time?.[0] : details.runtime,
    genres: (details.genres ?? []).map((genre: any) => genre.name),
    rating: details.vote_average || undefined,
    voteCount: details.vote_count || undefined,
    popularity: details.popularity || undefined,
    trendingRank: rank >= 0 ? rank + 1 : undefined,
    certification: certification(details, identity.mediaType),
    status: details.status || undefined,
    originalLanguage: details.original_language?.toUpperCase(),
    featuredReview,
    cast: (creditData?.cast ?? []).slice(0, 16).map((person: any) => ({
      id: person.id,
      name: person.name,
      character: isTv ? person.roles?.[0]?.character : person.character || undefined,
      profilePath: person.profile_path || undefined,
    })),
    creators: Array.from(new Set(creators)).slice(0, 5) as string[],
    companies: (details.production_companies ?? []).map((item: any) => item.name).slice(0, 6),
    countries: (details.production_countries ?? []).map((item: any) => item.name).slice(0, 5),
    networks: (details.networks ?? []).map((item: any) => item.name).slice(0, 5),
    keywords: keywordItems.map((item: any) => item.name).slice(0, 10),
    relatedTitles: (details.recommendations?.results ?? []).map((t: any) => ({
      id: t.id,
      title: t.name || t.title,
      image: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : undefined,
      rating: t.vote_average || undefined,
      voteCount: t.vote_count || undefined,
      mediaType: t.media_type || (t.name ? "tv" : "movie"),
    })),
    collectionTitle: collection?.name || details.belongs_to_collection?.name || undefined,
    collectionItems: isTv
      ? (details.seasons ?? []).filter((season: any) => season.season_number > 0).map((season: any) => ({
          id: season.id,
          title: season.name,
          subtitle: season.episode_count != null ? `${season.episode_count} episodes` : undefined,
          imagePath: season.poster_path || undefined,
        }))
      : (collection?.parts ?? []).map((movie: any) => ({
          id: movie.id,
          title: movie.title,
          subtitle: movie.release_date?.slice(0, 4),
          imagePath: movie.poster_path || undefined,
        })),
  };
}

async function fetchStoryData(options: Omit<UseTmdbStoryOptions, "enabled"> & { signal?: AbortSignal }): Promise<TmdbStoryData> {
  const hasCustomTmdbKey = Boolean(settingsStorage.getTmdbApiKey());
  const proxyApiUrl = getProxyApiUrl();

  // If user has a custom TMDB key, use TMDB directly (they explicitly configured it)
  if (hasCustomTmdbKey) {
    return fetchTmdbStory(options);
  }

  // If proxy API URL is present in env, try proxy API first (no TMDB key needed)
  if (proxyApiUrl && options.imdbId) {
    const proxyResult = await fetchProxyStory(options.imdbId, options.signal);
    if (proxyResult) return proxyResult;
  }

  // Fallback to TMDB if proxy is not configured in env, or if proxy failed / no imdbId
  const envKey = String(import.meta.env.VITE_TMDB_API_KEY || "").trim();
  if (envKey || settingsStorage.getTmdbApiKey()) {
    return fetchTmdbStory(options);
  }

  throw new Error("Could not fetch metadata. No proxy available and no TMDB API key configured.");
}

export function useTmdbStory({ enabled, imdbId, tmdbId, type }: UseTmdbStoryOptions) {
  const revision = settingsStorage.getTmdbApiKeyRevision();
  return useQuery({
    queryKey: ["tmdbStory", tmdbId || "", imdbId || "", type || "", revision],
    queryFn: ({ signal }) => fetchStoryData({ imdbId, signal, tmdbId, type }),
    enabled: enabled && Boolean(tmdbId || imdbId),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 48 * 60 * 60 * 1000,
    retry: 1,
  });
}

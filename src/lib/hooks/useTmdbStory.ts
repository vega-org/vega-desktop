import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { settingsStorage } from "../storage";

export type TmdbMediaType = "movie" | "tv";

export interface TmdbStoryCastMember {
  id: number;
  name: string;
  character?: string;
  profilePath?: string;
}

export interface TmdbStoryCollectionItem {
  id: number;
  title: string;
  subtitle?: string;
  imagePath?: string;
}

export interface TmdbStoryData {
  id: number;
  mediaType: TmdbMediaType;
  title: string;
  tagline?: string;
  overview?: string;
  backdropPaths: string[];
  posterPath?: string;
  trailerKey?: string;
  trailerName?: string;
  releaseDate?: string;
  runtime?: number;
  genres: string[];
  rating?: number;
  voteCount?: number;
  popularity?: number;
  trendingRank?: number;
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
}

interface UseTmdbStoryOptions {
  enabled: boolean;
  imdbId?: string;
  tmdbId?: number | string;
  type?: string;
}

const TMDB_API_URL = "https://api.themoviedb.org/3";

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
    ? "aggregate_credits,content_ratings,keywords,images,videos"
    : "credits,release_dates,keywords,images,videos";
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
  const trailer = videos.find((video: any) => video.type === "Trailer" && video.official)
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

  return {
    id: details.id,
    mediaType: identity.mediaType,
    title: isTv ? details.name : details.title,
    tagline: details.tagline || undefined,
    overview: details.overview || undefined,
    backdropPaths: Array.from(new Set([
      details.backdrop_path,
      ...(details.images?.backdrops ?? []).map((image: any) => image.file_path),
    ].filter(Boolean))).slice(0, 10) as string[],
    posterPath: details.poster_path || undefined,
    trailerKey: trailer?.key,
    trailerName: trailer?.name,
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

export function useTmdbStory({ enabled, imdbId, tmdbId, type }: UseTmdbStoryOptions) {
  const revision = settingsStorage.getTmdbApiKeyRevision();
  return useQuery({
    queryKey: ["tmdbStory", tmdbId || "", imdbId || "", type || "", revision],
    queryFn: ({ signal }) => fetchTmdbStory({ imdbId, signal, tmdbId, type }),
    enabled: enabled && Boolean(tmdbId || imdbId),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 48 * 60 * 60 * 1000,
    retry: 1,
  });
}

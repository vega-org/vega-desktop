import { AxiosStatic } from "axios";
import * as cheerio from "cheerio";
import { Content } from "../zustand/contentStore";
import { Crypto } from "../../platform/crypto";

export interface ProvidersList {
  name: string;
  value: string;
  type: string;
  flag: string;
}

export interface Post {
  title: string;
  link: string;
  image: string;
  provider?: string;
}

export declare enum TextTrackType {
  SUBRIP = "application/x-subrip",
  TTML = "application/ttml+xml",
  VTT = "text/vtt",
}

export type TextTracks = {
  title: string;
  language: ISO639_1;
  type: TextTrackType;
  uri: string;
}[];

// getStream
export interface Stream {
  server: string;
  link: string;
  type: string;
  localBaseDir?: string;
  quality?: "360" | "480" | "720" | "1080" | "2160";
  subtitles?: TextTracks;
  headers?: any;
}

// getInfo
export interface Info {
  title: string;
  image: string;
  logo?: string;
  poster?: string;
  synopsis: string;
  description?: string;
  year?: string | number;
  runtime?: string;
  imdbId?: string;
  tmdbId?: number | string;
  type: string;
  quickDownload?: boolean;
  populateMeta?: boolean;
  webUrl?: string;
  trailerUrl?: string;
  tags?: string[];
  cast?: string[];
  rating?: string;
  linkList: Link[];
}
// getEpisodeLinks
export interface EpisodeLink {
  id?: string;
  title: string;
  link: string;
  sourceLink?: string;
  description?: string;
  image?: string;
  quickDownload?: boolean;
}

export interface Link {
  title: string;
  quality?: string;
  episodesLink?: string;
  quickDownload?: boolean;
  directLinks?: {
    title: string;
    link: string;
    type?: "movie" | "series";
    description?: string;
    image?: string;
    quickDownload?: boolean;
  }[];
}

// catalog
export interface Catalog {
  title: string;
  filter: string;
}

export interface ProviderType {
  searchFilter?: string;
  catalog: Catalog[];
  genres: Catalog[];
  blurImage?: boolean;
  nonStreamableServer?: string[];
  nonDownloadableServer?: string[];
  GetStream: ({
    link,
    type,
    signal,
    providerContext,
    isDownload,
  }: {
    link: string;
    type: string;
    signal?: AbortSignal;
    providerContext: ProviderContext;
    isDownload?: boolean;
  }) => Promise<Stream[]>;
  GetHomePosts: ({
    filter,
    page,
    providerValue,
    signal,
    providerContext,
  }: {
    filter: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
    providerContext: ProviderContext;
  }) => Promise<Post[]>;
  GetEpisodeLinks?: ({
    url,
    providerContext,
  }: {
    url: string;
    providerContext: ProviderContext;
  }) => Promise<EpisodeLink[]>;
  GetMetaData: ({
    link,
    provider,
    providerContext,
  }: {
    link: string;
    provider: Content["provider"];
    providerContext: ProviderContext;
  }) => Promise<Info>;
  GetSearchPosts: ({
    searchQuery,
    page,
    providerValue,
    signal,
    providerContext,
  }: {
    searchQuery: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
    providerContext: ProviderContext;
  }) => Promise<Post[]>;
}

// Options to customize the WAF-solving WebView dialog.
export interface OpenWebViewOptions {
  // Title shown in the dialog header.
  title?: string;
  // Helper text shown under the title.
  description?: string;

  headers?: Record<string, string>;

  waitForCookie?: string;

  force?: boolean;
  // If set, the dialog auto-cancels (rejects) after this many milliseconds.
  timeoutMs?: number;
}

// Result returned to the provider after the user solves the challenge.
export interface OpenWebViewResult {
  // The page response after the challenge is solved: the rendered HTML of the
  // document (document.documentElement.outerHTML).
  data: string;
  // Cookie header value, e.g. "cf_clearance=abc; other=def".
  cookies: string;
  // Backward-compatible alias used by older provider modules.
  cookie?: string;
  // Cookies as a name -> value map.
  cookieMap: Record<string, string>;
  // The User-Agent used by the WebView.
  userAgent: string;
  // Expiry timestamp in seconds
  expires?: number;
  // The URL that was opened.
  url: string;
}

export interface ProviderKvStore {
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  keys: () => Promise<string[]>;
  clear: () => Promise<void>;
}

interface SettingsFieldBase {
  key: string;
  label: string;
  description?: string;
}

interface SettingsTextField extends SettingsFieldBase {
  type: "text";
  defaultValue?: string;
  placeholder?: string;
}

interface SettingsToggleField extends SettingsFieldBase {
  type: "toggle";
  defaultValue?: boolean;
}

interface SettingsSelectField extends SettingsFieldBase {
  type: "select";
  options: { label: string; value: string }[];
  defaultValue?: string;
}

interface SettingsMultiSelectField extends SettingsFieldBase {
  type: "multiselect";
  options: { label: string; value: string }[];
  defaultValue?: string[];
}

interface SettingsNumberField extends SettingsFieldBase {
  type: "number";
  defaultValue?: number;
  min?: number;
  max?: number;
}

export type SettingsField =
  | SettingsTextField
  | SettingsToggleField
  | SettingsSelectField
  | SettingsMultiSelectField
  | SettingsNumberField;

export type ProviderContext = {
  axios: AxiosStatic;
  Crypto: typeof Crypto;
  getBaseUrl: (providerValue: string) => Promise<string>;
  commonHeaders: Record<string, string>;
  cheerio: typeof cheerio;

  openWebView: (
    url: string,
    options?: OpenWebViewOptions,
  ) => Promise<OpenWebViewResult>;
  kvStore: ProviderKvStore;
};

export type ISO639_1 =
  | "aa"
  | "ab"
  | "ae"
  | "af"
  | "ak"
  | "am"
  | "an"
  | "ar"
  | "as"
  | "av"
  | "ay"
  | "az"
  | "ba"
  | "be"
  | "bg"
  | "bi"
  | "bm"
  | "bn"
  | "bo"
  | "br"
  | "bs"
  | "ca"
  | "ce"
  | "ch"
  | "co"
  | "cr"
  | "cs"
  | "cu"
  | "cv"
  | "cy"
  | "da"
  | "de"
  | "dv"
  | "dz"
  | "ee"
  | "el"
  | "en"
  | "eo"
  | "es"
  | "et"
  | "eu"
  | "fa"
  | "ff"
  | "fi"
  | "fj"
  | "fo"
  | "fr"
  | "fy"
  | "ga"
  | "gd"
  | "gl"
  | "gn"
  | "gu"
  | "gv"
  | "ha"
  | "he"
  | "hi"
  | "ho"
  | "hr"
  | "ht"
  | "hu"
  | "hy"
  | "hz"
  | "ia"
  | "id"
  | "ie"
  | "ig"
  | "ii"
  | "ik"
  | "io"
  | "is"
  | "it"
  | "iu"
  | "ja"
  | "jv"
  | "ka"
  | "kg"
  | "ki"
  | "kj"
  | "kk"
  | "kl"
  | "km"
  | "kn"
  | "ko"
  | "kr"
  | "ks"
  | "ku"
  | "kv"
  | "kw"
  | "ky"
  | "la"
  | "lb"
  | "lg"
  | "li"
  | "ln"
  | "lo"
  | "lt"
  | "lu"
  | "lv"
  | "mg"
  | "mh"
  | "mi"
  | "mk"
  | "ml"
  | "mn"
  | "mr"
  | "ms"
  | "mt"
  | "my"
  | "na"
  | "nb"
  | "nd"
  | "ne"
  | "ng"
  | "nl"
  | "nn"
  | "no"
  | "nr"
  | "nv"
  | "ny"
  | "oc"
  | "oj"
  | "om"
  | "or"
  | "os"
  | "pa"
  | "pi"
  | "pl"
  | "ps"
  | "pt"
  | "qu"
  | "rm"
  | "rn"
  | "ro"
  | "ru"
  | "rw"
  | "sa"
  | "sc"
  | "sd"
  | "se"
  | "sg"
  | "si"
  | "sk"
  | "sl"
  | "sm"
  | "sn"
  | "so"
  | "sq"
  | "sr"
  | "ss"
  | "st"
  | "su"
  | "sv"
  | "sw"
  | "ta"
  | "te"
  | "tg"
  | "th"
  | "ti"
  | "tk"
  | "tl"
  | "tn"
  | "to"
  | "tr"
  | "ts"
  | "tt"
  | "tw"
  | "ty"
  | "ug"
  | "uk"
  | "ur"
  | "uz"
  | "ve"
  | "vi"
  | "vo"
  | "wa"
  | "wo"
  | "xh"
  | "yi"
  | "yo"
  | "za"
  | "zh"
  | "zu";

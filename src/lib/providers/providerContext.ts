import axios from "axios";
import { getBaseUrl } from "./getBaseUrl";
import { headers } from "./headers";
import * as cheerio from "cheerio";
import { ProviderContext } from "./types";
import { Crypto } from "../../platform/crypto";
import { openWebView } from "../../platform/waf";
import { tauriAxiosAdapter } from "./tauriAxiosAdapter";

// Force all axios requests to go through the Tauri Rust backend.
// This completely bypasses the browser's CORS restrictions and allows us to spoof
// forbidden headers like 'Referer' and 'User-Agent'.
axios.defaults.adapter = tauriAxiosAdapter;

const KV_PREFIX = "vega_provider_kv:";
const MAX_KV_KEY_LENGTH = 256;
const MAX_KV_VALUE_BYTES = 1_000_000;

const validateKvKey = (key: unknown): string => {
  if (typeof key !== "string" || !key.trim() || key.length > MAX_KV_KEY_LENGTH) {
    throw new Error(
      `Invalid KV key: must be a non-empty string <= ${MAX_KV_KEY_LENGTH} characters`,
    );
  }
  return key;
};

const kvStore: import("./types").ProviderKvStore = {
  get: async <T = unknown>(key: string): Promise<T | undefined> => {
    const validKey = validateKvKey(key);
    const raw = localStorage.getItem(KV_PREFIX + validKey);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  },
  set: async (key: string, value: unknown): Promise<void> => {
    const validKey = validateKvKey(key);
    if (value === undefined) {
      localStorage.removeItem(KV_PREFIX + validKey);
      return;
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("KV value must be JSON-serializable");
    }
    if (serialized.length > MAX_KV_VALUE_BYTES) {
      throw new Error(`KV value exceeds limit of ${MAX_KV_VALUE_BYTES} bytes`);
    }
    localStorage.setItem(KV_PREFIX + validKey, serialized);
  },
  delete: async (key: string): Promise<boolean> => {
    const validKey = validateKvKey(key);
    const fullKey = KV_PREFIX + validKey;
    const exists = localStorage.getItem(fullKey) !== null;
    localStorage.removeItem(fullKey);
    return exists;
  },
  keys: async (): Promise<string[]> => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KV_PREFIX)) {
        keys.push(k.slice(KV_PREFIX.length));
      }
    }
    return keys;
  },
  clear: async (): Promise<void> => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KV_PREFIX)) {
        keys.push(k);
      }
    }
    for (const k of keys) {
      localStorage.removeItem(k);
    }
  },
};

/**
 * Context for provider functions.
 * This context is used to pass common dependencies to provider functions.
 */
export const providerContext: ProviderContext = {
  axios,
  getBaseUrl,
  commonHeaders: headers,
  Crypto,
  cheerio,
  openWebView,
  kvStore,
};

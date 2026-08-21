import axios from "axios";
import { providerFetch } from "../providers/tauriAxiosAdapter";
import { Catalog, EpisodeLink, Info, Post, SettingsField, Stream } from "../providers/types";
import { getBaseUrl } from "../providers/getBaseUrl";
import { openWebView } from "../../platform/waf";
import { extensionManager } from "./ExtensionManager";
import { extensionStorage } from "../storage/extensionStorage";
import { getErrorMessage } from "./providerErrors";

const MAX_PROVIDER_STATE_SIZE = 1_000_000;
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

const handleKvGet = (args: any): unknown => {
  const key = validateKvKey(args?.key);
  const raw = localStorage.getItem(KV_PREFIX + key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const handleKvSet = (args: any): void => {
  const key = validateKvKey(args?.key);
  const value = args?.value;
  if (value === undefined) {
    localStorage.removeItem(KV_PREFIX + key);
    return;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("KV value must be JSON-serializable");
  }
  if (serialized.length > MAX_KV_VALUE_BYTES) {
    throw new Error(`KV value exceeds limit of ${MAX_KV_VALUE_BYTES} bytes`);
  }
  localStorage.setItem(KV_PREFIX + key, serialized);
};

const handleKvDelete = (args: any): boolean => {
  const key = validateKvKey(args?.key);
  const fullKey = KV_PREFIX + key;
  const exists = localStorage.getItem(fullKey) !== null;
  localStorage.removeItem(fullKey);
  return exists;
};

const handleKvKeys = (): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(KV_PREFIX)) {
      keys.push(k.slice(KV_PREFIX.length));
    }
  }
  return keys;
};

const handleKvClear = (): void => {
  const keysToRemove = handleKvKeys();
  for (const k of keysToRemove) {
    localStorage.removeItem(KV_PREFIX + k);
  }
};

export class ProviderManager {
  private readonly providerState = new Map<string, Record<string, unknown>>();

  clearProviderState(providerValue: string): void {
    this.providerState.delete(providerValue);
  }

  private getProviderState(providerValue: string): Record<string, unknown> {
    return structuredClone(this.providerState.get(providerValue) ?? {});
  }

  private saveProviderState(providerValue: string, value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Provider state must be an object");
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > MAX_PROVIDER_STATE_SIZE) {
      throw new Error("Provider state exceeds the 1 MB limit");
    }
    this.providerState.set(
      providerValue,
      JSON.parse(serialized) as Record<string, unknown>,
    );
  }

  private isPrivateHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      normalized === "localhost" ||
      normalized === "::1" ||
      normalized === "0.0.0.0" ||
      normalized.endsWith(".localhost")
    ) {
      return true;
    }

    const ipv4 = normalized.split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part))) {
      return (
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb")
      );
    }

    const [first, second] = ipv4;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }

  private validateProviderUrl(value: unknown): URL {
    const url = new URL(String(value ?? ""));
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      this.isPrivateHostname(url.hostname)
    ) {
      throw new Error("Provider URL is not allowed");
    }
    return url;
  }

  private executeModule<T>(
    moduleCode: string,
    providerValue: string,
    exportName?: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (moduleCode.length > 2_000_000) {
      return Promise.reject(new Error("Provider module is too large"));
    }
    return new Promise<T>((resolve, reject) => {
      const worker = new Worker(
        new URL("./providerSandbox.worker.ts", import.meta.url),
        { type: "module", name: `provider-${providerValue}` },
      );
      const token = crypto.randomUUID();
      const timeout = window.setTimeout(() => {
        worker.terminate();
        reject(new Error(`Provider ${providerValue} timed out`));
      }, 120_000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", handleAbort);
        worker.terminate();
      };
      const handleAbort = () => {
        cleanup();
        reject(new DOMException("Provider request aborted", "AbortError"));
      };

      signal?.addEventListener("abort", handleAbort, { once: true });
      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || `Provider ${providerValue} failed`));
      };
      worker.onmessage = async (event) => {
        const message = event.data;
        if (!message || message.token !== token) return;
        if (message.type === "rpc") {
          try {
            const result = await this.handleRpc(
              message.operation,
              message.args,
            );
            worker.postMessage({
              type: "rpc-result",
              token,
              id: message.id,
              result,
            });
          } catch (error) {
            worker.postMessage({
              type: "rpc-result",
              token,
              id: message.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
        if (message.type === "result") {
          try {
            if (message.error) reject(new Error(message.error));
            else {
              this.saveProviderState(providerValue, message.state);
              resolve(message.result as T);
            }
          } catch (error) {
            reject(error);
          } finally {
            cleanup();
          }
        }
      };
      worker.postMessage({
        type: "invoke",
        token,
        moduleCode,
        exportName,
        args,
        state: this.getProviderState(providerValue),
      });
    });
  }

  private async handleRpc(operation: string, args: any): Promise<unknown> {
    if (operation === "getBaseUrl") {
      return getBaseUrl(String(args?.providerValue ?? ""));
    }
    if (operation === "openWebView") {
      const url = this.validateProviderUrl(args?.url);
      const result = await openWebView(url.toString(), args?.options);
      return { ...result, cookie: result.cookies };
    }
    if (operation === "fetch") {
      const url = this.validateProviderUrl(args?.url);
      const init = args?.init ?? {};
      const response = await providerFetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        redirect: init.redirect,
      });
      const data = await response.arrayBuffer();
      if (data.byteLength > 32 * 1024 * 1024) {
        throw new Error("Provider response is too large");
      }
      return {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers: Array.from(response.headers.entries()),
        data,
      };
    }
    if (operation === "kvGet") {
      return handleKvGet(args);
    }
    if (operation === "kvSet") {
      return handleKvSet(args);
    }
    if (operation === "kvDelete") {
      return handleKvDelete(args);
    }
    if (operation === "kvKeys") {
      return handleKvKeys();
    }
    if (operation === "kvClear") {
      return handleKvClear();
    }
    throw new Error(`Unsupported provider operation: ${operation}`);
  }
  getCatalog = async ({
    providerValue,
  }: {
    providerValue: string;
  }): Promise<Catalog[]> => {
    // Use extensionManager which now handles test mode automatically
    const catalogModule =
      extensionManager.getProviderModules(providerValue)?.modules.catalog;
    if (!catalogModule) {
      return [];
    }
    try {
      const moduleExports = await this.executeModule<{ catalog?: Catalog[] }>(
        catalogModule,
        providerValue,
      );
      return moduleExports.catalog || [];
    } catch (error) {
      console.error("Error loading catalog:", error);
      console.error("Module content:", catalogModule);
      throw new Error(
        getErrorMessage(
          error,
          `Invalid catalog module for provider: ${providerValue}`,
        ),
      );
    }
  };
  getGenres = async ({
    providerValue,
  }: {
    providerValue: string;
  }): Promise<Catalog[]> => {
    // Use extensionManager which now handles test mode automatically
    const catalogModule =
      extensionManager.getProviderModules(providerValue)?.modules.catalog;
    if (!catalogModule) {
      return [];
    }
    try {
      const moduleExports = await this.executeModule<{ genres?: Catalog[] }>(
        catalogModule,
        providerValue,
      );
      return moduleExports.genres || [];
    } catch (error) {
      console.error("Error loading genres:", error);
      console.error("Module content:", catalogModule);
      throw new Error(
        getErrorMessage(
          error,
          `Invalid catalog module for provider: ${providerValue}`,
        ),
      );
    }
  };
  getPosts = async ({
    filter,
    page,
    providerValue,
    signal,
  }: {
    filter: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
  }): Promise<Post[]> => {
    // Use extensionManager which now handles test mode automatically
    const getPostsModule = (
      await extensionManager.getProviderModulesAsync(providerValue)
    )?.modules.posts;
    if (!getPostsModule) {
      throw new Error(`No posts module found for provider: ${providerValue}`);
    }
    try {
      return await this.executeModule<Post[]>(
        getPostsModule,
        providerValue,
        "getPosts",
        { filter, page, providerValue },
        signal,
      );
    } catch (error) {
      console.error("Error in posts function:", error);
      throw new Error(
        getErrorMessage(
          error,
          `Failed to get posts from provider: ${providerValue}`,
        ),
      );
    }
  };
  getSearchPosts = async ({
    searchQuery,
    page,
    providerValue,
    signal,
  }: {
    searchQuery: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
  }): Promise<Post[]> => {
    // Use extensionManager which now handles test mode automatically
    const getPostsModule = (
      await extensionManager.getProviderModulesAsync(providerValue)
    )?.modules.posts;
    if (!getPostsModule) {
      throw new Error(`No posts module found for provider: ${providerValue}`);
    }
    try {
      return await this.executeModule<Post[]>(
        getPostsModule,
        providerValue,
        "getSearchPosts",
        { searchQuery, page, providerValue },
        signal,
      );
    } catch (error) {
      console.error("Error in search posts function:", error);
      throw new Error(
        getErrorMessage(
          error,
          `Failed to search posts from provider: ${providerValue}`,
        ),
      );
    }
  };
  getMetaData = async ({
    link,
    provider,
  }: {
    link: string;
    provider: string;
  }): Promise<Info> => {
    // Use extensionManager which now handles test mode automatically
    const getMetaDataModule = (
      await extensionManager.getProviderModulesAsync(provider)
    )?.modules.meta;
    if (!getMetaDataModule) {
      throw new Error(`No meta data module found for provider: ${provider}`);
    }
    try {
      return await this.executeModule<Info>(
        getMetaDataModule,
        provider,
        "getMeta",
        { link, provider },
      );
    } catch (error) {
      console.error("Error in meta data function:", error);
      throw new Error(
        getErrorMessage(
          error,
          `Failed to get metadata from provider: ${provider}`,
        ),
      );
    }
  };
  getStream = async ({
    link,
    type,
    signal,
    providerValue,
    isDownload,
  }: {
    link: string;
    type: string;
    signal?: AbortSignal;
    providerValue: string;
    isDownload?: boolean;
  }): Promise<Stream[]> => {
    // Use extensionManager which now handles test mode automatically
    const getStreamModule = (
      await extensionManager.getProviderModulesAsync(providerValue)
    )?.modules.stream;
    if (!getStreamModule) {
      throw new Error(`No stream module found for provider: ${providerValue}`);
    }
    try {
      console.log(`[Provider:${providerValue}] Executing stream module`, {
        link,
        type,
        isDownload: Boolean(isDownload),
        moduleBytes: getStreamModule.length,
      });
      const streams = await this.executeModule<Stream[]>(
        getStreamModule,
        providerValue,
        "getStream",
        { link, type, isDownload: Boolean(isDownload) },
        signal,
      );
      console.log(
        `[Provider:${providerValue}] getStream returned`,
        Array.isArray(streams) ? `${streams.length} stream(s)` : streams,
      );
      return streams;
    } catch (error) {
      console.error("Error in stream function:", error);
      throw new Error(
        getErrorMessage(
          error,
          `Failed to get stream from provider: ${providerValue}`,
        ),
      );
    }
  };
  getEpisodes = async ({
    url,
    providerValue,
  }: {
    url: string;
    providerValue: string;
  }): Promise<EpisodeLink[]> => {
    // Use extensionManager which now handles test mode automatically
    const getEpisodeLinksModule = (
      await extensionManager.getProviderModulesAsync(providerValue)
    )?.modules.episodes;
    if (!getEpisodeLinksModule) {
      throw new Error(
        `No episode links module found for provider: ${providerValue}`,
      );
    }
    try {
      return await this.executeModule<EpisodeLink[]>(
        getEpisodeLinksModule,
        providerValue,
        "getEpisodes",
        { url },
      );
    } catch (error) {
      console.error("Error in episodes function:", error);
      const errorMessage = getErrorMessage(
        error,
        `Failed to get episodes from provider: ${providerValue}`,
      );
      console.warn(errorMessage);
      throw new Error(errorMessage);
    }
  };
  getSettingsSchema = async ({
    providerValue,
  }: {
    providerValue: string;
  }): Promise<SettingsField[]> => {
    let providerModule = (
      await extensionManager.getProviderModulesAsync(providerValue)
    );
    let settingsModule = providerModule?.modules?.settings;

    if (!settingsModule) {
      try {
        const source = extensionStorage.getProviderSource();
        const testUrl = `http://localhost:3001/dist/${providerValue}/settings.js?v=${Date.now()}`;
        const sourceUrl = source?.url ? `${source.url}/dist/${providerValue}/settings.js` : null;

        let res;
        try {
          res = await axios.get(testUrl, { timeout: 2000 });
        } catch {
          if (sourceUrl) {
            res = await axios.get(sourceUrl, { timeout: 8000 });
          }
        }

        if (res?.data) {
          settingsModule = res.data;
          if (providerModule) {
            providerModule.modules.settings = settingsModule;
            extensionStorage.cacheProviderModules(providerModule);
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch settings module on-demand for ${providerValue}:`, err);
      }
    }

    if (!settingsModule) return [];
    try {
      return await this.executeModule<SettingsField[]>(
        settingsModule,
        providerValue,
        "getSettingsSchema",
        {},
      );
    } catch (error) {
      console.error("Error loading settings schema:", error);
      return [];
    }
  };
}

export const providerManager = new ProviderManager();

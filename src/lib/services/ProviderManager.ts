import axios from "axios";
import { providerFetch, platformAxiosAdapter } from "../../platform/network";
import { Catalog, EpisodeLink, Info, Post, SettingsField, Stream } from "../providers/types";
import { getBaseUrl } from "../providers/getBaseUrl";
import { openWebView } from "../../platform/waf";
import { extensionManager } from "./ExtensionManager";
import { extensionStorage } from "../storage/extensionStorage";
import { getSourceRequestHeaders } from "./sourceRequests";
import { getProviderFilesUrl } from "../utils/helpers";
import { getErrorMessage } from "./providerErrors";
import {
  getProviderPrefix,
  getScopedKvKey,
  migrateLegacyProviderData,
  providerAuthor,
  providerScopeId,
} from "../providers/providerScope";
import { getJarCookieHeader, getVerificationUserAgent } from "../providers/providerCookieJar";
import {publicHttpUrl} from '../../platform/publicNetworkPolicy';
import {runWithProviderSlot} from './providerExecutionLimits';
import {getProviderEngine} from './providerEngine';

const MAX_PROVIDER_STATE_SIZE = 1_000_000;
const MAX_KV_KEY_LENGTH = 256;
const MAX_KV_VALUE_BYTES = 1_000_000;

/** Module code and the source author it came from. */
interface ProviderCode {
  code: string;
  author: string;
}

const providerCode = (
  module: { sourceAuthor?: string } | undefined,
  code: string | undefined,
): ProviderCode | undefined =>
  code ? { code, author: providerAuthor(module?.sourceAuthor) } : undefined;

const validateKvKey = (key: unknown): string => {
  if (typeof key !== "string" || !key.trim() || key.length > MAX_KV_KEY_LENGTH) {
    throw new Error(
      `Invalid KV key: must be a non-empty string <= ${MAX_KV_KEY_LENGTH} characters`,
    );
  }
  return key;
};

const handleKvGet = (author: string, providerValue: string, args: any): unknown => {
  const key = validateKvKey(args?.key);
  const raw = localStorage.getItem(getScopedKvKey(author, providerValue, key));
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const handleKvSet = (author: string, providerValue: string, args: any): void => {
  const key = validateKvKey(args?.key);
  const fullKey = getScopedKvKey(author, providerValue, key);
  const value = args?.value;
  if (value === undefined) {
    localStorage.removeItem(fullKey);
    return;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("KV value must be JSON-serializable");
  }
  if (serialized.length > MAX_KV_VALUE_BYTES) {
    throw new Error(`KV value exceeds limit of ${MAX_KV_VALUE_BYTES} bytes`);
  }
  localStorage.setItem(fullKey, serialized);
};

const handleKvDelete = (author: string, providerValue: string, args: any): boolean => {
  const key = validateKvKey(args?.key);
  const fullKey = getScopedKvKey(author, providerValue, key);
  const exists = localStorage.getItem(fullKey) !== null;
  localStorage.removeItem(fullKey);
  return exists;
};

const handleKvKeys = (author: string, providerValue: string): string[] => {
  const keys: string[] = [];
  const prefix = getProviderPrefix(author, providerValue);
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      keys.push(k.slice(prefix.length));
    }
  }
  return keys;
};

const handleKvClear = (author: string, providerValue: string): void => {
  const prefix = getProviderPrefix(author, providerValue);
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      toRemove.push(k);
    }
  }
  for (const k of toRemove) {
    localStorage.removeItem(k);
  }
};

export class ProviderManager {
  // Keyed by providerScopeId(author, value).
  private readonly providerState = new Map<string, Record<string, unknown>>();

  clearProviderState(providerValue: string): void {
    const suffix = `/${encodeURIComponent(providerValue)}`;
    for (const scope of Array.from(this.providerState.keys())) {
      if (scope.endsWith(suffix)) this.providerState.delete(scope);
    }
  }

  private getProviderState(scope: string): Record<string, unknown> {
    return structuredClone(this.providerState.get(scope) ?? {});
  }

  private saveProviderState(scope: string, value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Provider state must be an object");
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > MAX_PROVIDER_STATE_SIZE) {
      throw new Error("Provider state exceeds the 1 MB limit");
    }
    this.providerState.set(
      scope,
      JSON.parse(serialized) as Record<string, unknown>,
    );
  }

  private validateProviderUrl(value: unknown): URL {
    return publicHttpUrl(String(value ?? ''));
  }

  private executeModule<T>(
    module: ProviderCode,
    providerValue: string,
    exportName?: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const { code: moduleCode, author } = module;
    const scope = providerScopeId(author, providerValue);
    migrateLegacyProviderData();
    if (moduleCode.length > 2_000_000) {
      return Promise.reject(new Error("Provider module is too large"));
    }
    return runWithProviderSlot(async () => {
      // Chromium 68 cannot permit WASM compilation on the page independently
      // of JavaScript eval. Keep the page CSP strict; its trusted classic
      // worker compiles the sandbox WASM in its own execution context.
      const engineModule = import.meta.env.VITE_WEBOS_COMPAT ? undefined : await getProviderEngine(signal);
      signal?.throwIfAborted();
      return new Promise<T>((resolve, reject) => {
      const worker = import.meta.env.VITE_WEBOS_COMPAT ? new Worker(
          new URL("./providerSandbox.legacy.worker.ts", import.meta.url),
          { name: `provider-${providerValue}` },
        ) : new Worker(
          new URL("./providerSandbox.worker.ts", import.meta.url),
          { type: "module", name: `provider-${providerValue}` },
        );
        const token = crypto.randomUUID();
        const rpcController = new AbortController();
        let rpcCount = 0;
        let inFlight = 0;
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error(`Provider ${providerValue} timed out`));
        }, 120_000);
        const cleanup = () => {
          rpcController.abort();
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
            if (++rpcCount > 256 || inFlight >= 16) {cleanup(); reject(new Error('Provider request limit exceeded')); return;}
            inFlight++;
            try {
              const result = await this.handleRpc(
                providerValue,
                author,
                message.operation,
                message.args,
                rpcController.signal,
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
            } finally {inFlight--;}
            return;
          }
          if (message.type === "result") {
            try {
              if (message.error) reject(new Error(message.error));
              else {
                this.saveProviderState(scope, message.state);
                resolve(message.result as T);
              }
            } catch (error) {
              reject(error);
            } finally {
              cleanup();
            }
          }
        };
        const invocation = {
          type: "invoke",
          engineModule,
          token,
          moduleCode,
          exportName,
          args,
          state: this.getProviderState(scope),
        };
        try {
          worker.postMessage(invocation);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'DataCloneError') {
            // Some older WebViews cannot clone WASM modules between workers.
            // They retain the isolated, per-call compilation path.
            try { worker.postMessage({...invocation, engineModule: undefined}); }
            catch (failure) { cleanup(); reject(failure); }
          } else { cleanup(); reject(error); }
        }
      });
    }, signal);
  }

  private async handleRpc(
    providerValue: string,
    author: string,
    operation: string,
    args: any,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (operation === "getBaseUrl") {
      return getBaseUrl(String(args?.providerValue ?? ""));
    }
    if (operation === "openWebView") {
      const url = this.validateProviderUrl(args?.url);
      const result = await openWebView(url.toString(), args?.options, author, providerValue, signal);
      return { ...result, cookie: result.cookies };
    }
    if (operation === "fetch") {
      const url = this.validateProviderUrl(args?.url);
      const init = args?.init ?? {};
      const response = await providerFetch(author, url, {
        method: init.method,
        headers: init.headers,
        body: Array.isArray(init.body) ? Uint8Array.from(init.body) : init.body,
        redirect: init.redirect,
        signal,
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (!reader) {const bytes = new Uint8Array(await response.arrayBuffer()); size = bytes.byteLength; if (size > 8 * 1024 * 1024) throw new Error('Provider response is too large'); chunks.push(bytes);}
      if (reader) try {while (true) {signal?.throwIfAborted(); const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > 8 * 1024 * 1024) throw new Error('Provider response is too large'); chunks.push(value);}}
      catch (error) {await reader.cancel().catch(() => {}); throw error;}
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk,offset); offset += chunk.byteLength;}
      const data = bytes.buffer;
      return {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers: Array.from(response.headers.entries()),
        data,
      };
    }
    if (operation === "kvGet") {
      return handleKvGet(author, providerValue, args);
    }
    if (operation === "kvSet") {
      return handleKvSet(author, providerValue, args);
    }
    if (operation === "kvDelete") {
      return handleKvDelete(author, providerValue, args);
    }
    if (operation === "kvKeys") {
      return handleKvKeys(author, providerValue);
    }
    if (operation === "kvClear") {
      return handleKvClear(author, providerValue);
    }
    throw new Error(`Unsupported provider operation: ${operation}`);
  }
  getCatalog = async ({
    providerValue,
  }: {
    providerValue: string;
  }): Promise<Catalog[]> => {
    // Use extensionManager which now handles test mode automatically
    const catalogRecord = extensionManager.getProviderModules(providerValue);
    const catalogModule = providerCode(
      catalogRecord,
      catalogRecord?.modules.catalog,
    );
    if (!catalogModule) {
      return [];
    }
    try {
      const moduleExports = await this.executeModule<{
        catalog?: Catalog[] | (() => Promise<Catalog[]> | Catalog[]);
      }>(catalogModule, providerValue);
      let catalog = moduleExports.catalog;
      if (typeof catalog === "function") {
        catalog = await (catalog as any)();
      }
      return Array.isArray(catalog) ? catalog : [];
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
    const catalogRecord = extensionManager.getProviderModules(providerValue);
    const catalogModule = providerCode(
      catalogRecord,
      catalogRecord?.modules.catalog,
    );
    if (!catalogModule) {
      return [];
    }
    try {
      const moduleExports = await this.executeModule<{
        genres?: Catalog[] | (() => Promise<Catalog[]> | Catalog[]);
      }>(catalogModule, providerValue);
      let genres = moduleExports.genres;
      if (typeof genres === "function") {
        genres = await (genres as any)();
      }
      return Array.isArray(genres) ? genres : [];
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
    const getPostsModuleRecord =
      await extensionManager.getProviderModulesAsync(providerValue);
    const getPostsModule = providerCode(getPostsModuleRecord, getPostsModuleRecord?.modules.posts);
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
    const getPostsModuleRecord =
      await extensionManager.getProviderModulesAsync(providerValue);
    const getPostsModule = providerCode(getPostsModuleRecord, getPostsModuleRecord?.modules.posts);
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
    const getMetaDataModuleRecord =
      await extensionManager.getProviderModulesAsync(provider);
    const getMetaDataModule = providerCode(getMetaDataModuleRecord, getMetaDataModuleRecord?.modules.meta);
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
    const getStreamModuleRecord =
      await extensionManager.getProviderModulesAsync(providerValue);
    const getStreamModule = providerCode(getStreamModuleRecord, getStreamModuleRecord?.modules.stream);
    if (!getStreamModule) {
      throw new Error(`No stream module found for provider: ${providerValue}`);
    }
    try {
      console.log(`[Provider:${providerValue}] Executing stream module`, {
        link,
        type,
        isDownload: Boolean(isDownload),
        moduleBytes: getStreamModule.code.length,
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
      return Array.isArray(streams)
        ? this.withJarCookies(getStreamModule.author, streams)
        : streams;
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
  /**
   * Provider requests skip the shared client cookie store, so streams get
   * their author's cookies (e.g. WAF clearance) as a header, unless the
   * provider set a Cookie header itself.
   */
  private withJarCookies(author: string, streams: Stream[]): Stream[] {
    return streams.map((stream) => {
      if (!stream || typeof stream.link !== 'string') throw new Error('Invalid provider stream');
      if (!stream.link.startsWith('magnet:')) publicHttpUrl(stream.link);
      if (stream.localBaseDir) throw new Error('Providers cannot supply local file directories');
      for (const subtitle of stream.subtitles || []) publicHttpUrl(subtitle.uri);
      const headers =
        stream.headers && typeof stream.headers === "object"
          ? stream.headers
          : {};
      if (!/^https?:/i.test(stream.link ?? "")) return stream;
      const cookie = getJarCookieHeader(author, stream.link);
      const verifiedAgent = getVerificationUserAgent(author, stream.link);
      if (!cookie && !verifiedAgent) return stream;
      const next = {...headers};
      if (cookie && !Object.keys(next).some(name => name.toLowerCase() === 'cookie')) next.Cookie = cookie;
      if (verifiedAgent) {
        for (const name of Object.keys(next)) if (/^sec-|^user-agent$/i.test(name)) delete next[name];
        next['User-Agent'] = verifiedAgent;
      }
      return {...stream, headers:next};
    });
  }

  getEpisodes = async ({
    url,
    providerValue,
  }: {
    url: string;
    providerValue: string;
  }): Promise<EpisodeLink[]> => {
    // Use extensionManager which now handles test mode automatically
    const getEpisodeLinksModuleRecord =
      await extensionManager.getProviderModulesAsync(providerValue);
    const getEpisodeLinksModule = providerCode(getEpisodeLinksModuleRecord, getEpisodeLinksModuleRecord?.modules.episodes);
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
  private settingsActionModules = new Map<string, ProviderCode>();

  runSettingsAction = async ({providerValue, sourceAuthor, key}: {
    providerValue: string; sourceAuthor?: string; key: string;
  }): Promise<void> => {
    const schema = await this.getSettingsSchema({providerValue, sourceAuthor});
    if (!schema.some(field => field.type === 'button' && field.key === key)) {
      throw new Error('Unknown provider settings action');
    }
    const module = this.settingsActionModules.get(providerScopeId(sourceAuthor, providerValue));
    if (!module) throw new Error('Provider settings module is unavailable');
    await this.executeModule(module, providerValue, 'onSettingsAction', {key});
  };

  getSettingsSchema = async ({
    providerValue,
    sourceAuthor,
  }: {
    providerValue: string;
    sourceAuthor?: string;
  }): Promise<SettingsField[]> => {
    let providerModule = (
      await extensionManager.getProviderModulesAsync(providerValue, sourceAuthor)
    );
    let settingsModule = providerModule?.modules?.settings;
    let settingsAuthor = providerModule?.sourceAuthor;

    if (!settingsModule) {
      try {
        const source = sourceAuthor
          ? extensionStorage.getProviderSources().find(item => item.author === sourceAuthor)
          : extensionStorage.getProviderSource();
        const testUrl = `http://localhost:3001/dist/${providerValue}/settings.js?v=${Date.now()}`;
        const path = extensionStorage
          .getInstalledProviders()
          .find(
            (p) =>
              p.value === providerValue && p.source?.author === source?.author,
          )?.path;
        const sourceUrl = source?.url
          ? `${getProviderFilesUrl(source.url, providerValue, path)}/settings.js`
          : null;

        let res;
        try {
          res = await axios.get(testUrl, { timeout: 2000 });
          settingsAuthor = undefined;
        } catch {
          if (sourceUrl) {
            settingsAuthor = source?.author;
            res = await axios.get(sourceUrl, {
              timeout: 8000,
              // Use the active platform's networking and source credentials.
              adapter: platformAxiosAdapter,
              headers: getSourceRequestHeaders(source?.author, sourceUrl),
            });
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
    this.settingsActionModules.set(providerScopeId(sourceAuthor, providerValue), {code: settingsModule, author: providerAuthor(settingsAuthor)});
    try {
      return await this.executeModule<SettingsField[]>(
        { code: settingsModule, author: providerAuthor(settingsAuthor) },
        providerValue,
        "getSettingsSchema",
        {},
      );
    } catch (error) {
      console.error("Error loading settings schema:", error);
      return [];
    }
  };

  clearProviderStorage = async (
    providerValue: string,
    sourceAuthor?: string,
  ): Promise<void> => {
    migrateLegacyProviderData();
    const author = providerAuthor(sourceAuthor);
    this.providerState.delete(providerScopeId(author, providerValue));
    handleKvClear(author, providerValue);
  };
}

export const providerManager = new ProviderManager();

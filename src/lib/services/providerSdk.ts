import "./providerSdkPolyfills";
import axios, { AxiosHeaders, type AxiosAdapter } from "axios";
import * as cheerio from "cheerio";
import { headers as commonHeaders } from "../providers/headers";
import { getErrorMessage } from "./providerErrors";
import { hoistYieldInForOf } from "./quickjsCompat";

type SerializedResponse = {
  status: number;
  statusText: string;
  url: string;
  headers: Array<[string, string]>;
  data: ArrayBuffer;
};


declare const __hostSend: (message: string) => void;
declare const __hostFinish: (message: string) => void;
declare const __randomBytes: number[];
let nextRpcId = 0;
const pendingRpc = new Map<number, {resolve: (result: any) => void; reject: (error: Error) => void}>();
let totalRpc = 0;
const rpc = <T>(operation: string, args: unknown): Promise<T> => {
  if (pendingRpc.size >= 16 || ++totalRpc > 256) return Promise.reject(new Error('Provider request limit exceeded'));
  const id = ++nextRpcId;
  return new Promise<T>((resolve, reject) => {
    pendingRpc.set(id, {resolve, reject});
    __hostSend(JSON.stringify({id, operation, args}));
  });
};
(globalThis as any).__providerReply = (message: any) => {
  const entry = pendingRpc.get(message.id); if (!entry) return;
  pendingRpc.delete(message.id);
  message.error ? entry.reject(new Error(message.error)) : entry.resolve(message.result);
};
let timerId = 0;
const cancelledTimers = new Set<number>();
(globalThis as any).setTimeout = (fn: (...args: any[]) => void, ms = 0, ...args: any[]) => {
  const id = ++timerId;
  rpc('__sleep', {ms}).then(() => {if (!cancelledTimers.delete(id)) fn(...args);}, () => {});
  return id;
};
(globalThis as any).clearTimeout = (id: number) => {cancelledTimers.add(id);};
(globalThis as any).setInterval = () => {throw new Error('Provider intervals are unsupported');};
(globalThis as any).clearInterval = () => {};
let randomOffset = 0;
const Crypto = {
  digestStringAsync: (algorithm: string, data: string) => rpc<string>('__digest', {algorithm, data}),
  randomUUID: () => {
    if (randomOffset + 16 > __randomBytes.length) throw new Error('Provider random budget exceeded');
    const bytes = __randomBytes.slice(randomOffset, randomOffset += 16);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const h = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
  },
};
const serializeBody = async (body: BodyInit | null | undefined) => {
  if (body == null) {
    return { data: undefined, contentType: null };
  }
  const serialized = new Response(body);
  return {
    data: await serialized.arrayBuffer(),
    contentType: serialized.headers.get("content-type"),
  };
};

const headerEntries = (source: unknown): Array<[string, string]> => {
  const entries: Array<[string, string]> = [];
  if (!source) return entries;
  if (typeof (source as Headers).forEach === "function") {
    (source as Headers).forEach((value, key) => entries.push([key, value]));
    return entries;
  }
  if (Array.isArray(source)) {
    for (const pair of source) {
      if (Array.isArray(pair) && pair.length >= 2 && pair[0] && pair[1] != null) {
        entries.push([String(pair[0]), String(pair[1])]);
      }
    }
    return entries;
  }
  if (typeof source === "object") {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (value != null) {
        entries.push([key, String(value)]);
      }
    }
  }
  return entries;
};

const sandboxFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response & { rawHeaders?: Array<[string, string]> }> => {
  const request = input instanceof Request ? input : undefined;
  const url = request?.url ?? input.toString();
  const mergedHeaders: Array<[string, string]> = [
    ...headerEntries(request?.headers),
    ...headerEntries(init.headers),
  ];
  const serializedBody = await serializeBody(init.body);
  if (
    serializedBody.contentType &&
    !mergedHeaders.some(([k]) => k.toLowerCase() === "content-type")
  ) {
    mergedHeaders.push(["Content-Type", serializedBody.contentType]);
  }

  const response = await rpc<SerializedResponse>("fetch", {
    url,
    init: {
      method: init.method ?? request?.method,
      headers: mergedHeaders,
      body: serializedBody.data ? Array.from(new Uint8Array(serializedBody.data)) : undefined,
      redirect: init.redirect,
    },
  });

  const res = new Response(Uint8Array.from(response.data as unknown as number[]), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }) as Response & { rawHeaders?: Array<[string, string]> };
  // A constructed Response has an empty URL; preserve the native final URL.
  Object.defineProperty(res, "url", { value: response.url });
  res.rawHeaders = response.headers;
  return res;
};

const sandboxAxiosAdapter: AxiosAdapter = async (config) => {
  let url = config.url ?? "";
  if (config.baseURL && !/^https?:/i.test(url)) {
    url = `${config.baseURL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
  }
  if (config.params) {
    const query = new URLSearchParams(config.params).toString();
    if (query) url += `${url.includes("?") ? "&" : "?"}${query}`;
  }

  const response = await sandboxFetch(url, {
    method: config.method?.toUpperCase(),
    headers: config.headers as HeadersInit,
    body:
      config.data == null || typeof config.data === "string"
        ? config.data
        : JSON.stringify(config.data),
    redirect: config.maxRedirects === 0 ? "manual" : "follow",
  });
  const responseHeaders = new AxiosHeaders();
  response.headers.forEach((value, key) => responseHeaders.set(key, value));

  const rawHeaders = (response as any).rawHeaders as Array<[string, string]> | undefined;
  if (rawHeaders) {
    const setCookies: string[] = [];
    for (const [key, value] of rawHeaders) {
      if (key.toLowerCase() === "set-cookie" || key.toLowerCase() === "x-set-cookie") {
        setCookies.push(value);
      }
    }
    if (setCookies.length > 0) {
      responseHeaders.set("set-cookie", setCookies);
      responseHeaders.set("x-set-cookie", setCookies);
    }
  } else {
    const xSetCookie = response.headers.get("x-set-cookie");
    if (xSetCookie) {
      responseHeaders.set("set-cookie", xSetCookie);
      responseHeaders.set("x-set-cookie", xSetCookie);
    }
  }

  let data: unknown;
  if (config.responseType === "arraybuffer") {
    data = await response.arrayBuffer();
  } else if (config.responseType === "blob") {
    data = await response.blob();
  } else {
    const text = await response.text();
    if (config.responseType === "text") {
      data = text;
    } else {
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = text;
      }
    }
  }

  const result = {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    config,
    request: {
      url,
      responseURL: response.url,
      res: { responseUrl: response.url },
    },
  };

  const validateStatus =
    config.validateStatus ||
    ((status: number) => status >= 200 && status < 300);

  if (!validateStatus(response.status)) {
    const error: any = new Error(
      "Request failed with status code " + response.status,
    );
    error.config = config;
    error.request = { url };
    error.response = result;
    error.isAxiosError = true;
    error.status = response.status;
    throw error;
  }

  return result;
};

axios.defaults.adapter = sandboxAxiosAdapter;

let providerGlobal: Record<string, unknown> = {};
const kvStore = Object.freeze({
  get: <T = unknown>(key: string): Promise<T | undefined> =>
    rpc<T | undefined>("kvGet", { key }),
  set: (key: string, value: unknown): Promise<void> =>
    rpc<void>("kvSet", { key, value }),
  delete: (key: string): Promise<boolean> =>
    rpc<boolean>("kvDelete", { key }),
  keys: (): Promise<string[]> =>
    rpc<string[]>("kvKeys", {}),
  clear: (): Promise<void> =>
    rpc<void>("kvClear", {}),
});

const providerContext = Object.freeze({
  axios,
  cheerio,
  Crypto: Object.freeze(Crypto),
  commonHeaders: { ...commonHeaders },
  getBaseUrl: (providerValue: string) =>
    rpc<string>("getBaseUrl", { providerValue }),
  openWebView: (url: string, options?: unknown) =>
    rpc("openWebView", { url, options }),
  kvStore,
});

const createAwaiter = () =>
  function __awaiter(
    thisArg: unknown,
    args: unknown,
    PromiseConstructor: PromiseConstructor | undefined,
    generator: (...generatorArgs: unknown[]) => Generator,
  ) {
    const Constructor = PromiseConstructor ?? Promise;
    const adopt = (value: unknown) =>
      value instanceof Constructor
        ? value
        : new Constructor((resolve) => resolve(value));
    return new Constructor((resolve, reject) => {
      const fulfilled = (value: unknown) => {
        try {
          step(iterator.next(value));
        } catch (error) {
          reject(error);
        }
      };
      const rejected = (value: unknown) => {
        try {
          step(iterator.throw(value));
        } catch (error) {
          reject(error);
        }
      };
      const step = (result: IteratorResult<unknown>) => {
        if (result.done) resolve(result.value);
        else adopt(result.value).then(fulfilled, rejected);
      };
      const iterator = generator.apply(thisArg, (args as unknown[]) ?? []);
      step(iterator.next());
    });
  };

const executeProvider = async (
  moduleCode: string,
  exportName?: string,
  args: Record<string, unknown> = {},
) => {
  const exports: Record<string, unknown> = {};
  const module = { exports };
  const compileModule = (source: string) =>
    new Function(
      "exports",
      "module",
      "require",
      "console",
      "Promise",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "fetch",
      "__awaiter",
      "providerGlobal",
      "globalThis",
      "self",
      "postMessage",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "Worker",
      "SharedWorker",
      "BroadcastChannel",
      "indexedDB",
      "caches",
      `"use strict";\n${source}`,
    );

  let executeModule: Function;
  try {
    executeModule = compileModule(moduleCode);
  } catch (error) {
    if (!/stack underflow/i.test(getErrorMessage(error))) {
      throw error;
    }
    const patchedCode = hoistYieldInForOf(moduleCode);
    if (patchedCode === moduleCode) {
      throw error;
    }
    executeModule = compileModule(patchedCode);
  }

  executeModule(
    exports,
    module,
    () => ({}),
    console,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    sandboxFetch,
    createAwaiter(),
    providerGlobal,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  const moduleExports = module.exports as Record<string, unknown>;
  if (!exportName) {
    const resolvedExports: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(moduleExports)) {
      if (typeof value === "function") {
        try {
          resolvedExports[key] = await value({
            ...args,
            signal: new AbortController().signal,
            providerContext,
          });
        } catch {
          resolvedExports[key] = value;
        }
      } else {
        resolvedExports[key] = value;
      }
    }
    return resolvedExports;
  }
  const providerFunction = moduleExports[exportName];
  if (typeof providerFunction !== "function") {
    throw new Error(`Provider module does not export ${exportName}`);
  }
  return providerFunction({
    ...args,
    signal: new AbortController().signal,
    providerContext,
  });
};


(globalThis as any).__providerStart = async (message: any) => {
  providerGlobal = message.state || {};
  try {
    const result = await executeProvider(message.moduleCode, message.exportName, message.args);
    __hostFinish(JSON.stringify({result, state: providerGlobal}));
  } catch (error) {__hostFinish(JSON.stringify({error: getErrorMessage(error)}));}
};

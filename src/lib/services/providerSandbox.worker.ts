import axios, { AxiosHeaders, type AxiosAdapter } from "axios";
import * as cheerio from "cheerio";
import { Crypto } from "../../platform/crypto";
import { headers as commonHeaders } from "../providers/headers";

type RpcOperation = "fetch" | "getBaseUrl" | "openWebView";

type HostMessage =
  | {
      type: "invoke";
      token: string;
      moduleCode: string;
      exportName?: string;
      args?: Record<string, unknown>;
      state: Record<string, unknown>;
    }
  | {
      type: "rpc-result";
      token: string;
      id: number;
      result?: unknown;
      error?: string;
    };

type SerializedResponse = {
  status: number;
  statusText: string;
  url: string;
  headers: Array<[string, string]>;
  data: ArrayBuffer;
};

const workerScope = globalThis as typeof globalThis & {
  postMessage: (message: unknown) => void;
};
const sendMessage = workerScope.postMessage.bind(workerScope);
const addMessageListener = workerScope.addEventListener.bind(workerScope);
let activeToken = "";
let nextRpcId = 0;
const pendingRpc = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();

const disableAmbientCapability = (name: string) => {
  try {
    Object.defineProperty(workerScope, name, {
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
  } catch {
    // Some WebView globals are non-configurable; function parameters below still shadow them.
  }
};

[
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "postMessage",
  "importScripts",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "indexedDB",
  "caches",
].forEach(disableAmbientCapability);

const rpc = <T>(operation: RpcOperation, args: unknown): Promise<T> => {
  const id = ++nextRpcId;
  return new Promise<T>((resolve, reject) => {
    pendingRpc.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    sendMessage({ type: "rpc", token: activeToken, id, operation, args });
  });
};

const serializeBody = async (body: BodyInit | null | undefined) => {
  if (body == null) return undefined;
  return new Response(body).arrayBuffer();
};

const sandboxFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> => {
  const request = input instanceof Request ? input : undefined;
  const url = request?.url ?? input.toString();
  const headers = new Headers(request?.headers);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  const response = await rpc<SerializedResponse>("fetch", {
    url,
    init: {
      method: init.method ?? request?.method,
      headers: Array.from(headers.entries()),
      body: await serializeBody(init.body),
      redirect: init.redirect,
    },
  });

  return new Response(response.data, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
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

  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    config,
    request: { url },
  };
};

axios.defaults.adapter = sandboxAxiosAdapter;

let providerGlobal: Record<string, unknown> = {};
const providerContext = Object.freeze({
  axios,
  cheerio,
  Crypto: Object.freeze(Crypto),
  commonHeaders: { ...commonHeaders },
  getBaseUrl: (providerValue: string) =>
    rpc<string>("getBaseUrl", { providerValue }),
  openWebView: (url: string, options?: unknown) =>
    rpc("openWebView", { url, options }),
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
  const executeModule = new Function(
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
    `"use strict";\n${moduleCode}`,
  );

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
  if (!exportName) return moduleExports;
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

addMessageListener("message", async (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "rpc-result") {
    if (message.token !== activeToken) return;
    const pending = pendingRpc.get(message.id);
    if (!pending) return;
    pendingRpc.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result);
    return;
  }

  if (message.type !== "invoke" || activeToken) return;
  activeToken = message.token;
  providerGlobal = message.state;
  try {
    const result = await executeProvider(
      message.moduleCode,
      message.exportName,
      message.args,
    );
    sendMessage({
      type: "result",
      token: activeToken,
      result,
      state: providerGlobal,
    });
  } catch (error) {
    sendMessage({
      type: "result",
      token: activeToken,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

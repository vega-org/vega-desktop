import { AxiosAdapter, AxiosResponse, AxiosHeaders } from "axios";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import { buildRequestCookieHeader, storeSetCookies } from "./providerCookieJar";
import { settingsStorage } from "../storage/SettingsStorage";
import {publicHttpUrl} from "../../platform/publicNetworkPolicy";

async function executeNativeFetch(
  url: string,
  method: string,
  headers: Headers,
  body: any,
  config: any,
): Promise<{
  responseData: any;
  responseStatus: number;
  responseStatusText: string;
  responseHeaders: AxiosHeaders;
  requestUrl: string;
}> {
  const plainHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    plainHeaders[key] = value;
  });

  const response = await tauriFetch(url, {
    method,
    headers: plainHeaders,
    body,
    redirect: config.maxRedirects === 0 ? "manual" : "follow",
  });

  const responseHeaders = new AxiosHeaders();
  response.headers.forEach((value, key) => {
    responseHeaders.set(key, value);
  });

  const responseType = config.responseType || "json";
  let responseData: any;

  if (responseType === "json") {
    const text = await response.text();
    try {
      responseData = text ? JSON.parse(text) : {};
    } catch {
      responseData = text;
    }
  } else if (responseType === "text") {
    responseData = await response.text();
  } else if (responseType === "arraybuffer") {
    responseData = await response.arrayBuffer();
  } else if (responseType === "blob") {
    responseData = await response.blob();
  } else {
    responseData = await response.text();
  }

  return {
    responseData,
    responseStatus: response.status,
    responseStatusText: response.statusText,
    responseHeaders,
    requestUrl: response.url,
  };
}

function decodeResponseData(rawBytes: Uint8Array, responseType: string): any {
  if (responseType === "json") {
    const text = new TextDecoder().decode(rawBytes);
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return text;
    }
  } else if (responseType === "text") {
    return new TextDecoder().decode(rawBytes);
  } else if (responseType === "arraybuffer") {
    return rawBytes.buffer;
  } else if (responseType === "blob") {
    return new Blob([rawBytes as any]);
  }
  return new TextDecoder().decode(rawBytes);
}

/**
 * Sends a provider request. Cookies come from, and go to, the jar of the
 * provider's source author only; the shared client cookie store is skipped.
 */
export async function providerFetch(
  author: string,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();

  const plainHeaders: Record<string, string> = {};
  if (Array.isArray(init.headers)) {
    for (const pair of init.headers) {
      if (Array.isArray(pair) && pair.length >= 2 && pair[0] && pair[1] != null) {
        plainHeaders[String(pair[0])] = String(pair[1]);
      }
    }
  } else if (init.headers && typeof init.headers.forEach === "function") {
    init.headers.forEach((value, key) => {
      plainHeaders[key] = value;
    });
  } else if (init.headers && typeof init.headers === "object") {
    for (const [key, value] of Object.entries(init.headers)) {
      if (value != null) {
        plainHeaders[key] = String(value);
      }
    }
  }

  const cookieKey = Object.keys(plainHeaders).find(
    (k) => k.toLowerCase() === "cookie"
  );
  const cookieHeader = buildRequestCookieHeader(
    author,
    url,
    cookieKey ? plainHeaders[cookieKey] : undefined,
  );
  if (cookieKey) delete plainHeaders[cookieKey];
  if (cookieHeader) plainHeaders["Cookie"] = cookieHeader;

  let body: number[] | undefined;
  if (init.body != null) {
    const serializedBody = new Response(init.body);
    const generatedContentType = serializedBody.headers.get("content-type");
    const hasContentType = Object.keys(plainHeaders).some(
      (k) => k.toLowerCase() === "content-type"
    );
    if (generatedContentType && !hasContentType) {
      plainHeaders["Content-Type"] = generatedContentType;
    }
    body = Array.from(new Uint8Array(await serializedBody.arrayBuffer()));
  }
  type NativeResponse = {status:number; status_text:string; url:string; headers:Array<[string,string]>; data:number[]};
  let response: NativeResponse | undefined;
  let currentUrl = publicHttpUrl(url).href;
  let method = (init.method || 'GET').toUpperCase();
  const isDohEnabled =
    typeof settingsStorage.isDohEnabled === "function"
      ? settingsStorage.isDohEnabled()
      : true;
  const dohProvider = isDohEnabled ? settingsStorage.getDohProvider() : "system";
  for (let hop = 0; hop <= 10; hop++) {
    init.signal?.throwIfAborted();
    publicHttpUrl(currentUrl);
    response = await invoke<NativeResponse>('doh_fetch', {args:{
      url:currentUrl, method, headers:plainHeaders, body, max_redirects:0,
      doh_provider:dohProvider, doh_custom_url:settingsStorage.getDohCustomUrl(), isolated_cookies:true,
    }});
    init.signal?.throwIfAborted();
    const setCookies = response.headers.filter(([name]) => name.toLowerCase() === 'set-cookie').map(([,value]) => value);
    storeSetCookies(author, currentUrl, setCookies);
    const location = response.headers.find(([name]) => name.toLowerCase() === 'location')?.[1];
    if (![301,302,303,307,308].includes(response.status) || !location || init.redirect === 'manual') break;
    if (init.redirect === 'error') throw new Error('Provider redirects are disabled');
    if (hop === 10) throw new Error('Too many provider redirects');
    const next = publicHttpUrl(new URL(location,currentUrl).href).href;
    if (new URL(next).origin !== new URL(currentUrl).origin) for (const key of Object.keys(plainHeaders)) {
      if (!['accept','accept-language','user-agent','referer','range'].includes(key.toLowerCase())) delete plainHeaders[key];
    }
    for (const key of Object.keys(plainHeaders)) if (key.toLowerCase() === 'cookie') delete plainHeaders[key];
    const nextCookies = buildRequestCookieHeader(author,next);
    if (nextCookies) plainHeaders.Cookie = nextCookies;
    if (response.status === 303 && method !== 'HEAD' || [301,302].includes(response.status) && method === 'POST') {
      method = 'GET'; body = undefined;
      for (const key of Object.keys(plainHeaders)) if (['content-type','content-encoding'].includes(key.toLowerCase())) delete plainHeaders[key];
    }
    currentUrl = next;
  }
  if (!response) throw new Error('Provider request did not return a response');
  const headerEntries: Array<[string, string]> = [];
  for (const [key, value] of response.headers) {
    const lowerKey = key.toLowerCase();
    headerEntries.push([lowerKey, value]);
    if (lowerKey === "set-cookie") {
      headerEntries.push(["x-set-cookie", value]);
    }
  }
  const responseData = new Uint8Array(response.data);
  const responseHeaders = {
    get(name: string) {
      const values = headerEntries
        .filter(([key]) => key === name.toLowerCase())
        .map(([, value]) => value);
      return values.length > 0 ? values.join(", ") : null;
    },
    getSetCookie() {
      return headerEntries
        .filter(([key]) => key === "set-cookie")
        .map(([, value]) => value);
    },
    has(name: string) {
      return headerEntries.some(([key]) => key === name.toLowerCase());
    },
    entries() {
      return headerEntries[Symbol.iterator]();
    },
    keys() {
      return headerEntries.map(([key]) => key)[Symbol.iterator]();
    },
    values() {
      return headerEntries.map(([, value]) => value)[Symbol.iterator]();
    },
    forEach(
      callback: (value: string, key: string, headers: unknown) => void,
      thisArg?: unknown,
    ) {
      headerEntries.forEach(([key, value]) => {
        callback.call(thisArg, value, key, this);
      });
    },
    [Symbol.iterator]() {
      return this.entries();
    },
  };

  return {
    status: response.status,
    statusText: response.status_text,
    ok: response.status >= 200 && response.status < 300,
    redirected: response.url !== url,
    type: "basic",
    url: response.url || url,
    headers: responseHeaders,
    body: null,
    bodyUsed: false,
    clone() {
      return this;
    },
    async arrayBuffer() {
      return responseData.slice().buffer;
    },
    async blob() {
      return new Blob([responseData]);
    },
    async bytes() {
      return responseData.slice();
    },
    async formData() {
      const contentType = responseHeaders.get("content-type");
      if (!contentType) {
        throw new TypeError("Response has no Content-Type header");
      }
      return new Response(responseData.slice(), {
        headers: { "Content-Type": contentType },
      }).formData();
    },
    async json() {
      return JSON.parse(new TextDecoder().decode(responseData));
    },
    async text() {
      return new TextDecoder().decode(responseData);
    },
  } as unknown as Response;
}

export const tauriAxiosAdapter: AxiosAdapter = async (
  config,
): Promise<AxiosResponse> => {
  let url = config.url || "";
  if (config.baseURL && !url.startsWith("http")) {
    url = `${config.baseURL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
  }

  if (config.params) {
    const params = new URLSearchParams(config.params);
    url += (url.includes("?") ? "&" : "?") + params.toString();
  }

  const headers = new Headers();
  if (config.headers) {
    Object.keys(config.headers).forEach((key) => {
      const val = config.headers[key];
      if (val != null && val !== "") {
        headers.append(key, String(val));
      }
    });
  }

  const method = (config.method || "GET").toUpperCase();
  let body: any = undefined;

  if (config.data) {
    if (typeof config.data === "string") {
      body = config.data;
    } else if (config.data instanceof FormData) {
      body = config.data;
    } else if (config.data instanceof URLSearchParams) {
      body = config.data.toString();
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    } else {
      body = JSON.stringify(config.data);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }
  }

  let responseData: any;
  let responseStatus: number;
  let responseStatusText: string;
  const responseHeaders = new AxiosHeaders();
  let requestUrl = url;

  const isDohEnabled = settingsStorage.isDohEnabled();
  const forceDoh = (config as any).forceDoh === true;
  const canUseDoh =
    (isDohEnabled || forceDoh) &&
    (body === undefined || typeof body === "string");

  const shouldUseDoh = canUseDoh;

  if (shouldUseDoh) {
    try {
      const dohProvider = settingsStorage.getDohProvider();
      const dohCustomUrl = settingsStorage.getDohCustomUrl();

      const plainHeaders: Record<string, string> = {};
      headers.forEach((value, key) => {
        plainHeaders[key] = value;
      });

      const response: any = await invoke("doh_fetch", {
        args: {
          url,
          method,
          headers: plainHeaders,
          body,
          max_redirects: config.maxRedirects,
          doh_provider: dohProvider,
          doh_custom_url: dohCustomUrl,
        },
      });

      const dohStatus = response.status as number;
      const rawResponseHeaders = Array.isArray(response.headers)
        ? (response.headers as Array<[string, string]>)
        : Object.entries(response.headers || {}).map(
            ([key, value]) => [key, String(value)] as [string, string],
          );
      const cfMitigated = rawResponseHeaders.find(
        ([key]) => key.toLowerCase() === "cf-mitigated",
      )?.[1];

      // If Cloudflare issued a challenge via DoH, fall back to native fetch.
      // This happens when a domain starts requiring WAF after the initial request.
      if (
        (dohStatus === 403 || dohStatus === 503) &&
        cfMitigated === "challenge"
      ) {
        console.warn(
          "[DoH] WAF challenge detected, falling back to native fetch for:",
          url,
        );
        const nativeResult = await executeNativeFetch(
          url,
          method,
          headers,
          body,
          config,
        );
        responseData = nativeResult.responseData;
        responseStatus = nativeResult.responseStatus;
        responseStatusText = nativeResult.responseStatusText;
        Object.keys(nativeResult.responseHeaders).forEach((k) =>
          responseHeaders.set(k, nativeResult.responseHeaders[k]),
        );
        requestUrl = nativeResult.requestUrl;
      } else {
        responseStatus = dohStatus;
        responseStatusText = response.status_text;
        requestUrl = response.url || url;

        const groupedHeaders = new Map<string, string[]>();
        rawResponseHeaders.forEach(([key, value]) => {
          const normalizedKey = key.toLowerCase();
          const values = groupedHeaders.get(normalizedKey) || [];
          values.push(value);
          groupedHeaders.set(normalizedKey, values);
        });
        groupedHeaders.forEach((values, key) => {
          responseHeaders.set(key, values.length === 1 ? values[0] : values);
        });

        const rawBytes = new Uint8Array(response.data);
        responseData = decodeResponseData(
          rawBytes,
          config.responseType || "json",
        );
      }
    } catch (e) {
      console.error("[DoH] fetch failed, falling back to native fetch:", e);
      const nativeResult = await executeNativeFetch(
        url,
        method,
        headers,
        body,
        config,
      );
      responseData = nativeResult.responseData;
      responseStatus = nativeResult.responseStatus;
      responseStatusText = nativeResult.responseStatusText;
      Object.keys(nativeResult.responseHeaders).forEach((k) =>
        responseHeaders.set(k, nativeResult.responseHeaders[k]),
      );
      requestUrl = nativeResult.requestUrl;
    }
  } else {
    const nativeResult = await executeNativeFetch(
      url,
      method,
      headers,
      body,
      config,
    );
    responseData = nativeResult.responseData;
    responseStatus = nativeResult.responseStatus;
    responseStatusText = nativeResult.responseStatusText;
    Object.keys(nativeResult.responseHeaders).forEach((k) =>
      responseHeaders.set(k, nativeResult.responseHeaders[k]),
    );
    requestUrl = nativeResult.requestUrl;
  }

  const responseObj = {
    data: responseData,
    status: responseStatus,
    statusText: responseStatusText,
    headers: responseHeaders,
    config,
    request: requestUrl,
  };

  const validateStatus =
    config.validateStatus ||
    ((status: number) => status >= 200 && status < 300);

  if (!validateStatus(responseStatus)) {
    const error: any = new Error(
      `Request failed with status code ${responseStatus}`,
    );
    error.config = config;
    error.request = requestUrl;
    error.response = responseObj;
    error.isAxiosError = true;
    error.status = responseStatus;
    throw error;
  }

  return responseObj;
};

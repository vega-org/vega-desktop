import { AxiosAdapter, AxiosResponse, AxiosHeaders } from 'axios';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { getGlobalCookies } from './cookieStore';
import { settingsStorage } from '../storage/SettingsStorage';

async function executeNativeFetch(
  url: string,
  method: string,
  headers: Headers,
  body: any,
  config: any,
): Promise<{ responseData: any; responseStatus: number; responseStatusText: string; responseHeaders: AxiosHeaders; requestUrl: string }> {
  const response = await tauriFetch(url, { method, headers, body });

  const responseHeaders = new AxiosHeaders();
  response.headers.forEach((value, key) => {
    responseHeaders.set(key, value);
  });

  const responseType = config.responseType || 'json';
  let responseData: any;

  if (responseType === 'json') {
    const text = await response.text();
    try {
      responseData = text ? JSON.parse(text) : {};
    } catch {
      responseData = text;
    }
  } else if (responseType === 'text') {
    responseData = await response.text();
  } else if (responseType === 'arraybuffer') {
    responseData = await response.arrayBuffer();
  } else if (responseType === 'blob') {
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
  if (responseType === 'json') {
    const text = new TextDecoder().decode(rawBytes);
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return text;
    }
  } else if (responseType === 'text') {
    return new TextDecoder().decode(rawBytes);
  } else if (responseType === 'arraybuffer') {
    return rawBytes.buffer;
  } else if (responseType === 'blob') {
    return new Blob([rawBytes as any]);
  }
  return new TextDecoder().decode(rawBytes);
}

export const tauriAxiosAdapter: AxiosAdapter = async (config): Promise<AxiosResponse> => {
  let url = config.url || '';
  if (config.baseURL && !url.startsWith('http')) {
    url = `${config.baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  }

  if (config.params) {
    const params = new URLSearchParams(config.params);
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  const headers = new Headers();
  if (config.headers) {
    Object.keys(config.headers).forEach((key) => {
      const val = config.headers[key];
      if (val != null && val !== '') {
        headers.append(key, String(val));
      }
    });
  }

  const globalCookies = getGlobalCookies(url);
  if (globalCookies) {
    const existingCookie = headers.get('Cookie');
    if (existingCookie) {
      headers.set('Cookie', existingCookie + '; ' + globalCookies);
    } else {
      headers.set('Cookie', globalCookies);
    }
  }

  const method = (config.method || 'GET').toUpperCase();
  let body: any = undefined;

  if (config.data) {
    if (typeof config.data === 'string') {
      body = config.data;
    } else if (config.data instanceof FormData) {
      body = config.data;
    } else if (config.data instanceof URLSearchParams) {
      body = config.data.toString();
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
    } else {
      body = JSON.stringify(config.data);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
  }

  let responseData: any;
  let responseStatus: number;
  let responseStatusText: string;
  const responseHeaders = new AxiosHeaders();
  let requestUrl = url;

  const isDohEnabled = settingsStorage.isDohEnabled();
  const canUseDoh = isDohEnabled && (body === undefined || typeof body === 'string');

  // Cloudflare's cf_clearance cookie is bound to the browser's TLS fingerprint.
  // reqwest (Rust) has a different fingerprint than Chromium, so WAF cookies
  // will always be rejected by doh_fetch. Use native fetch for WAF-protected domains.
  const hasWafCookies = !!globalCookies;
  const shouldUseDoh = canUseDoh && !hasWafCookies;

  if (shouldUseDoh) {
    try {
      const dohProvider = settingsStorage.getDohProvider();
      const dohCustomUrl = settingsStorage.getDohCustomUrl();

      const plainHeaders: Record<string, string> = {};
      headers.forEach((value, key) => {
        plainHeaders[key] = value;
      });

      const response: any = await invoke('doh_fetch', {
        args: {
          url,
          method,
          headers: plainHeaders,
          body,
          doh_provider: dohProvider,
          doh_custom_url: dohCustomUrl,
        }
      });

      const dohStatus = response.status as number;
      const cfMitigated = response.headers?.['cf-mitigated'];

      // If Cloudflare issued a challenge via DoH, fall back to native fetch.
      // This happens when a domain starts requiring WAF after the initial request.
      if ((dohStatus === 403 || dohStatus === 503) && cfMitigated === 'challenge') {
        console.warn('[DoH] WAF challenge detected, falling back to native fetch for:', url);
        const nativeResult = await executeNativeFetch(url, method, headers, body, config);
        responseData = nativeResult.responseData;
        responseStatus = nativeResult.responseStatus;
        responseStatusText = nativeResult.responseStatusText;
        Object.keys(nativeResult.responseHeaders).forEach(k => responseHeaders.set(k, nativeResult.responseHeaders[k]));
        requestUrl = nativeResult.requestUrl;
      } else {
        responseStatus = dohStatus;
        responseStatusText = response.status_text;

        if (response.headers) {
          Object.keys(response.headers).forEach(key => {
            responseHeaders.set(key, response.headers[key]);
          });
        }

        const rawBytes = new Uint8Array(response.data);
        responseData = decodeResponseData(rawBytes, config.responseType || 'json');
      }
    } catch (e) {
      console.error('[DoH] fetch failed, falling back to native fetch:', e);
      const nativeResult = await executeNativeFetch(url, method, headers, body, config);
      responseData = nativeResult.responseData;
      responseStatus = nativeResult.responseStatus;
      responseStatusText = nativeResult.responseStatusText;
      Object.keys(nativeResult.responseHeaders).forEach(k => responseHeaders.set(k, nativeResult.responseHeaders[k]));
      requestUrl = nativeResult.requestUrl;
    }
  } else {
    const nativeResult = await executeNativeFetch(url, method, headers, body, config);
    responseData = nativeResult.responseData;
    responseStatus = nativeResult.responseStatus;
    responseStatusText = nativeResult.responseStatusText;
    Object.keys(nativeResult.responseHeaders).forEach(k => responseHeaders.set(k, nativeResult.responseHeaders[k]));
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

  const validateStatus = config.validateStatus || ((status: number) => status >= 200 && status < 300);

  if (!validateStatus(responseStatus)) {
    const error: any = new Error(`Request failed with status code ${responseStatus}`);
    error.config = config;
    error.request = requestUrl;
    error.response = responseObj;
    error.isAxiosError = true;
    error.status = responseStatus;
    throw error;
  }

  return responseObj;
};


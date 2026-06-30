import { AxiosAdapter, AxiosResponse, AxiosHeaders } from 'axios';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { getGlobalCookies } from './cookieStore';
import { settingsStorage } from '../storage/SettingsStorage';

export const tauriAxiosAdapter: AxiosAdapter = async (config): Promise<AxiosResponse> => {
  // Build URL with params
  let url = config.url || '';
  if (config.baseURL && !url.startsWith('http')) {
    url = `${config.baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  }

  if (config.params) {
    const params = new URLSearchParams(config.params);
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  // Convert headers
  const headers = new Headers();
  const plainHeaders: Record<string, string> = {};
  if (config.headers) {
    Object.keys(config.headers).forEach((key) => {
      headers.append(key, config.headers[key] as string);
      plainHeaders[key] = config.headers[key] as string;
    });
  }

  // Inject global cookies from the purely in-memory cookie store
  const globalCookies = getGlobalCookies(url);
  if (globalCookies) {
    const existingCookie = headers.get('Cookie');
    if (existingCookie) {
      headers.set('Cookie', existingCookie + '; ' + globalCookies);
      plainHeaders['Cookie'] = existingCookie + '; ' + globalCookies;
    } else {
      headers.set('Cookie', globalCookies);
      plainHeaders['Cookie'] = globalCookies;
    }
  }

  // Convert method and body
  const method = (config.method || 'GET').toUpperCase();
  let body: any = undefined;

  if (config.data) {
    if (typeof config.data === 'string') {
      body = config.data;
    } else if (config.data instanceof FormData) {
      // tauri fetch handles FormData
      body = config.data;
    } else if (config.data instanceof URLSearchParams) {
      body = config.data.toString();
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
      plainHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      body = JSON.stringify(config.data);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
        plainHeaders['Content-Type'] = 'application/json';
      }
    }
  }

  const isDohEnabled = settingsStorage.isDohEnabled();
  // We can only use doh_fetch if body is string or undefined, FormData isn't supported yet in the Rust command.
  const canUseDoh = isDohEnabled && (body === undefined || typeof body === 'string');

  let responseData: any;
  let responseStatus: number;
  let responseStatusText: string;
  const responseHeaders = new AxiosHeaders();
  let requestUrl = url;

  if (canUseDoh) {
    // Execute using custom Rust DoH fetch
    try {
      const dohProvider = settingsStorage.getDohProvider();
      const dohCustomUrl = settingsStorage.getDohCustomUrl();

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

      responseStatus = response.status;
      responseStatusText = response.status_text;

      if (response.headers) {
        Object.keys(response.headers).forEach(key => {
          responseHeaders.set(key, response.headers[key]);
        });
      }

      // Handle response data based on responseType
      const responseType = config.responseType || 'json';
      const rawBytes = new Uint8Array(response.data);

      if (responseType === 'json') {
        const text = new TextDecoder().decode(rawBytes);
        try {
          responseData = text ? JSON.parse(text) : {};
        } catch {
          responseData = text;
        }
      } else if (responseType === 'text') {
        responseData = new TextDecoder().decode(rawBytes);
      } else if (responseType === 'arraybuffer') {
        responseData = rawBytes.buffer;
      } else if (responseType === 'blob') {
        responseData = new Blob([rawBytes]);
      } else {
        responseData = new TextDecoder().decode(rawBytes);
      }
    } catch (e) {
      console.error('[DoH] fetch failed:', e);
      throw e;
    }
  } else {
    // Fallback to Tauri's native fetch
    const response = await tauriFetch(url, {
      method,
      headers,
      body,
    });

    responseStatus = response.status;
    responseStatusText = response.statusText;
    requestUrl = response.url;

    response.headers.forEach((value, key) => {
      responseHeaders.set(key, value);
    });

    const responseType = config.responseType || 'json';

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
  }

  const responseObj = {
    data: responseData,
    status: responseStatus,
    statusText: responseStatusText,
    headers: responseHeaders,
    config,
    request: requestUrl,
  };

  const validateStatus = config.validateStatus || ((status) => status >= 200 && status < 300);

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

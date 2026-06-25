import { AxiosAdapter, AxiosResponse, AxiosHeaders } from 'axios';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getGlobalCookies } from './cookieStore';

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
  if (config.headers) {
    Object.keys(config.headers).forEach((key) => {
      headers.append(key, config.headers[key] as string);
    });
  }

  // Inject global cookies from the purely in-memory cookie store
  const globalCookies = getGlobalCookies(url);
  if (globalCookies) {
    const existingCookie = headers.get('Cookie');
    if (existingCookie) {
      headers.set('Cookie', existingCookie + '; ' + globalCookies);
    } else {
      headers.set('Cookie', globalCookies);
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
    } else {
      body = JSON.stringify(config.data);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
  }

  // Execute using Tauri's native fetch to bypass CORS and header restrictions
  const response = await tauriFetch(url, {
    method,
    headers,
    body,
  });

  // Read response
  let responseData: any;
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

  // Convert response headers
  const responseHeaders = new AxiosHeaders();
  response.headers.forEach((value, key) => {
    responseHeaders.set(key, value);
  });

  const responseObj = {
    data: responseData,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    config,
    request: response.url,
  };

  const validateStatus = config.validateStatus || ((status) => status >= 200 && status < 300);
  
  if (!validateStatus(response.status)) {
    const error: any = new Error(`Request failed with status code ${response.status}`);
    error.config = config;
    error.request = response.url;
    error.response = responseObj;
    error.isAxiosError = true;
    error.status = response.status;
    throw error;
  }

  return responseObj;
};

import axios from 'axios';
import type {AxiosAdapter} from 'axios';
import {buildRequestCookieHeader, getJarCookies, getVerificationUserAgent, storeSetCookies} from '../lib/providers/providerCookieJar';
import {assertBrowserHeaders, getPlatformHost, isBrowserExtensionInstalled, isTauriRuntime, PlatformAccessError, waitForPlatformHost, requirePublicDestinationChecks} from './host';
import {publicHttpUrl} from './publicNetworkPolicy';

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason || new DOMException('Request aborted', 'AbortError');
}

async function withCancellation<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  throwIfAborted(signal);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason || new DOMException('Request aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, {once: true});
  });
  try {return await Promise.race([task(), aborted]);}
  finally {signal.removeEventListener('abort', onAbort);}
}

function makeRequest(input: RequestInfo | URL, init: RequestInit) {
  // In a real browser Request's header guard may discard Cookie/Referer/etc.
  // Capture caller headers first so a host bridge receives them intact.
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  const request = new Request(input, {...init, credentials: 'omit'});
  // Keep generated multipart boundaries and other automatic body headers too.
  request.headers.forEach((value, name) => {if (!headers.has(name)) headers.set(name, value);});
  return {request, headers};
}

/** General HTTP entry point; installed hosts and browser extensions are peers. */
export async function platformFetch(input: RequestInfo | URL, init: RequestInit = {}, scope?: string): Promise<Response> {
  if (isTauriRuntime()) {
    const {fetch} = await import('@tauri-apps/plugin-http');
    return fetch(input, init);
  }

  const {request, headers} = makeRequest(input, init);
  throwIfAborted(request.signal);
  await withCancellation(request.signal, waitForPlatformHost);
  const host = getPlatformHost();
  if (!host && scope && isBrowserExtensionInstalled()) {
    throw new PlatformAccessError('HOST_REQUIRED', 'Website access is required. Open the Vega extension and choose Allow all websites.');
  }
  if (!host?.request || !host.capabilities.restrictedHeaders) assertBrowserHeaders(headers);
  if (host?.request) {
    if (scope) requirePublicDestinationChecks(host);
    if (scope && !host.capabilities.isolatedCookies) {
      throw new PlatformAccessError('COOKIE_ISOLATION_REQUIRED', 'The platform host must isolate provider cookies before it can perform provider requests.');
    }
    if (request.redirect === 'manual' && !host.capabilities.manualRedirects) {
      throw new PlatformAccessError('HOST_REQUIRED', 'This platform host does not support manual redirects.');
    }
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : Array.from(new Uint8Array(await request.arrayBuffer()));
    throwIfAborted(request.signal);
    const result = await withCancellation(request.signal, () => host.request!({
      url: request.url, method: request.method, headers: [...headers], body,
      redirect: request.redirect, credentials: 'omit', scope, cookies: scope ? getJarCookies(scope) : undefined,
    }, request.signal));
    throwIfAborted(request.signal);
    if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599 || !Array.isArray(result.headers) || !Array.isArray(result.body)) {
      throw new PlatformAccessError('INVALID_HOST_RESPONSE', 'The platform host returned an invalid HTTP response.');
    }
    if (result.cookieUpdates !== undefined && (!Array.isArray(result.cookieUpdates) || result.cookieUpdates.length > 10 || result.cookieUpdates.some(update => {
      try {return !/^https?:$/.test(new URL(update.url).protocol) || !Array.isArray(update.headers) || update.headers.length > 100 || update.headers.some(value => typeof value !== 'string');}
      catch {return true;}
    }))) throw new PlatformAccessError('INVALID_HOST_RESPONSE', 'The platform host returned invalid redirect cookies.');
    if (scope) for (const update of result.cookieUpdates || []) storeSetCookies(scope, update.url, update.headers);
    const responseHeaders = new Headers(result.headers);
    for (const [name, value] of result.headers) if (name.toLowerCase() === 'set-cookie') responseHeaders.append('x-set-cookie', value);
    const response = new Response(request.method === 'HEAD' || [204, 205, 304].includes(result.status) ? null : Uint8Array.from(result.body), {
      status: result.status, statusText: result.statusText, headers: responseHeaders,
    });
    Object.defineProperty(response, 'url', {value: result.url || request.url});
    Object.defineProperty(response, 'redirected', {value: Boolean(result.url && result.url !== request.url)});
    // Preserve separate Set-Cookie lines even on WebViews without getSetCookie.
    Object.defineProperty(response.headers, 'getSetCookie', {value: () => result.headers.filter(([key]) => key.toLowerCase() === 'set-cookie').map(([, value]) => value)});
    return response;
  }

  // Ordinary browser fetch cannot expose a manual cross-origin redirect. Fail
  // closed rather than following an unchecked destination for provider traffic.
  if (scope) publicHttpUrl(request.url);
  const response = await globalThis.fetch(scope && request.redirect === 'follow' ? new Request(request, {redirect:'manual'}) : request);
  if (response.type === 'opaqueredirect') {
    throw new PlatformAccessError('HOST_REQUIRED', 'Reading a redirect response requires platform-managed networking.');
  }
  return response;
}

/** Provider fetch preserves the existing per-source-author cookie boundary. */
export async function providerFetch(author: string, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (isTauriRuntime()) {
    const native = await import('../lib/providers/tauriAxiosAdapter');
    return native.providerFetch(author, input, init);
  }
  const {request, headers} = makeRequest(input, init);
  const cookie = buildRequestCookieHeader(author, request.url, headers.get('cookie') || undefined);
  if (cookie) headers.set('cookie', cookie);
  const verifiedAgent = getVerificationUserAgent(author, request.url);
  if (verifiedAgent) {
    for (const name of [...headers.keys()]) if (/^sec-/i.test(name)) headers.delete(name);
    headers.set('user-agent', verifiedAgent);
  }
  const response = await platformFetch(request, {headers}, author);
  const cookieHeaders = response.headers as Headers & {getSetCookie?: () => string[]};
  storeSetCookies(author, response.url || request.url, cookieHeaders.getSetCookie?.() || []);
  return response;
}

/** Keep Tauri's existing DoH/TLS path; public browser HTTP needs no extension. */
export const platformAxiosAdapter: AxiosAdapter = async config => {
  if (isTauriRuntime()) {
    const native = await import('../lib/providers/tauriAxiosAdapter');
    return native.tauriAxiosAdapter(config);
  }
  const headers = new axios.AxiosHeaders(config.headers);
  // Axios's URL/init path adds its own User-Agent unless disabled. Leave the
  // browser's default alone, while preserving any explicitly requested value.
  if (!headers.has('User-Agent')) headers.set('User-Agent', false);
  const browserConfig = {
    ...config,
    headers,
    withCredentials: false,
    // Axios supports null Request to pass URL/init directly to injected fetch.
    // Only platformFetch should construct Request after capturing raw headers.
    env: {...config.env, fetch: platformFetch, Request: null as unknown as typeof Request},
  };
  // The installed Axios resolver accepts config to select its fetch factory;
  // its bundled declaration currently exposes only the first argument.
  const resolveAdapter = axios.getAdapter as (name: 'fetch', input: typeof browserConfig) => AxiosAdapter;
  return resolveAdapter('fetch', browserConfig)(browserConfig);
};

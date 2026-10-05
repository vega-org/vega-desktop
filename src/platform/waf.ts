import {OpenWebViewOptions, OpenWebViewResult} from '../lib/providers/types';
import {useWafStore} from '../lib/zustand/wafStore';
import {headers as commonHeaders} from '../lib/providers/headers';
import {providerAuthor} from '../lib/providers/providerScope';
import {deleteJarCookie, getJarCookieMap} from '../lib/providers/providerCookieJar';

const pickUserAgent = (
  h?: Record<string, string>,
): string | undefined => {
  if (!h) return undefined;
  const key = Object.keys(h).find(k => k.toLowerCase() === 'user-agent');
  return key ? h[key] : undefined;
};

const pendingRequests = new Map<
  string,
  Array<{resolve: (val: any) => void; reject: (err: any) => void}>
>();

/**
 * Opens the WAF solver for a provider. Cookies are read from and saved to the
 * jar of `author` (the provider's source author), never another author's.
 */
export const openWebView = async (
  url: string,
  options: OpenWebViewOptions | undefined,
  authorRaw: string,
): Promise<OpenWebViewResult> => {
  if (!url) {
    throw new Error('openWebView: a url is required');
  }
  const author = providerAuthor(authorRaw);

  const hostname = url.includes('://') ? url.split('/')[2] : url;
  const siteKey = options?.waitForCookie ? `${hostname}:${options.waitForCookie}` : hostname;
  const cacheKey = `${author}|${siteKey}`;

  // Request Coalescing: If a WAF solver is already running for this URL,
  // just wait for its result instead of queuing another dialog!
  if (pendingRequests.has(cacheKey)) {
    console.log(`[WAF] Coalescing parallel request for: ${cacheKey}`);
    return new Promise((resolve, reject) => {
      pendingRequests.get(cacheKey)?.push({resolve, reject});
    });
  }

  // Handle force and fast path
  if (!options?.force && options?.waitForCookie) {
    const cookieMap = getJarCookieMap(author, url);
    if (cookieMap[options.waitForCookie]) {
      // Fast path: we already have the awaited cookie, return it immediately
      const existingCookies = Object.entries(cookieMap)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');

      return {
        data: '',
        cookies: existingCookies,
        cookie: existingCookies,
        cookieMap,
        url,
        userAgent: pickUserAgent(options?.headers) || commonHeaders['User-Agent'],
      };
    }
  } else if (options?.waitForCookie) {
    // Forced: the saved cookie is bad, drop it before opening
    deleteJarCookie(author, url, options.waitForCookie);
  }

  pendingRequests.set(cacheKey, []);

  // Use common headers if not provided
  if (!options) options = {};
  if (!options.headers) options.headers = {};
  if (!pickUserAgent(options.headers)) {
    options.headers['User-Agent'] = commonHeaders['User-Agent'];
  }

  return new Promise((resolve, reject) => {
    console.log('[WAF] Queuing new solver for:', url);

    // WafDialog saves the solved cookies to the author's jar.
    const wrappedResolve = (result: OpenWebViewResult) => {
      resolve(result);
      const pending = pendingRequests.get(cacheKey) || [];
      pendingRequests.delete(cacheKey);
      pending.forEach(p => p.resolve(result));
    };

    const wrappedReject = (error: any) => {
      reject(error);
      const pending = pendingRequests.get(cacheKey) || [];
      pendingRequests.delete(cacheKey);
      pending.forEach(p => p.reject(error));
    };

    useWafStore.getState().enqueue({
      ...options,
      url,
      author,
      resolve: wrappedResolve,
      reject: wrappedReject,
    });
  });
};

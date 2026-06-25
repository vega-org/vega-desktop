import {OpenWebViewOptions, OpenWebViewResult} from '../lib/providers/types';
import {useWafStore} from '../lib/zustand/wafStore';
import {headers as commonHeaders} from '../lib/providers/headers';
import {updateGlobalCookies} from '../lib/providers/cookieStore';

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

export const openWebView = async (
  url: string,
  options?: OpenWebViewOptions,
): Promise<OpenWebViewResult> => {
  if (!url) {
    throw new Error('openWebView: a url is required');
  }

  // Request Coalescing: If a WAF solver is already running for this URL,
  // just wait for its result instead of queuing another dialog!
  if (pendingRequests.has(url)) {
    console.log(`[WAF] Coalescing parallel request for: ${url}`);
    return new Promise((resolve, reject) => {
      pendingRequests.get(url)?.push({resolve, reject});
    });
  }

  pendingRequests.set(url, []);

  // Use common headers if not provided
  if (!options) options = {};
  if (!options.headers) options.headers = {};
  if (!pickUserAgent(options.headers)) {
    options.headers['User-Agent'] = commonHeaders['User-Agent'];
  }

  return new Promise((resolve, reject) => {
    console.log('[WAF] Queuing new solver for:', url);

    const wrappedResolve = (result: OpenWebViewResult) => {
      if (result.cookies) {
        updateGlobalCookies(new URL(url).origin, result.cookies);
      }
      
      resolve(result);
      const pending = pendingRequests.get(url) || [];
      pendingRequests.delete(url);
      pending.forEach(p => p.resolve(result));
    };

    const wrappedReject = (error: any) => {
      reject(error);
      const pending = pendingRequests.get(url) || [];
      pendingRequests.delete(url);
      pending.forEach(p => p.reject(error));
    };

    useWafStore.getState().enqueue({
      url,
      ...options,
      resolve: wrappedResolve,
      reject: wrappedReject,
    });
  });
};

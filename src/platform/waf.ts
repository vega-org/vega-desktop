import {OpenWebViewOptions, OpenWebViewResult} from '../lib/providers/types';

export const openWebView = async (
  url: string,
  // @ts-ignore
  options?: OpenWebViewOptions,
): Promise<OpenWebViewResult> => {
  console.warn('WAF Solver is not fully implemented yet on desktop.', url);
  // Just return empty data for now, providers that require WAF will fail or be skipped
  return {
    data: '',
    cookies: '',
    cookieMap: {},
    userAgent: navigator.userAgent,
    url,
  };
};

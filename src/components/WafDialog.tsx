import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { useWafStore, WafRequest } from '../lib/zustand/wafStore';
import { OpenWebViewResult } from '../lib/providers/types';
import './WafDialog.css';

interface CookieInfo {
  name: string;
  value: string;
  domain: string;
  path: string;
  http_only: boolean;
  secure: boolean;
  expires?: number;
}

const WAF_WEBVIEW_LABEL = 'waf-solver';

async function getCookiesForUrl(url: string): Promise<Record<string, string>> {
  try {
    const cookies = await invoke<CookieInfo[]>('get_cookies_for_url', {
      webviewLabel: WAF_WEBVIEW_LABEL,
      url,
    });
    const map: Record<string, string> = {};
    for (const c of cookies) {
      map[c.name] = c.value;
    }
    return map;
  } catch {
    return {};
  }
}

function buildCookieString(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export const WafDialog: React.FC = () => {
  const request = useWafStore(state => state.requests[0]);
  const remove = useWafStore(state => state.remove);

  const [visible, setVisible] = useState(false);

  const settledRef = useRef(false);
  const webviewRef = useRef<WebviewWindow | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialCookiesRef = useRef<Set<string>>(new Set());
  const webviewReadyRef = useRef(false);

  useEffect(() => {
    settledRef.current = false;
    webviewReadyRef.current = false;
    initialCookiesRef.current = new Set();
  }, [request?.id]);

  const cleanup = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const closeWebview = useCallback(async () => {
    if (webviewRef.current) {
      try {
        await webviewRef.current.destroy();
      } catch {
        // already closed
      }
      webviewRef.current = null;
    }
    setVisible(false);
  }, []);

  const finalizeResolve = useCallback(
    async (req: WafRequest) => {
      cleanup();
      try {
        const cookiesRaw = await invoke<CookieInfo[]>('get_cookies_for_url', {
          webviewLabel: WAF_WEBVIEW_LABEL,
          url: req.url,
        });

        const cookieMap: Record<string, string> = {};
        let expiresAt: number | null = null;

        for (const c of cookiesRaw) {
          cookieMap[c.name] = c.value;
          // Use the specific cookie we were waiting for to determine the session expiry,
          if (req.waitForCookie && c.name === req.waitForCookie && c.expires) {
            expiresAt = c.expires;
          }
        }

        const cookies = buildCookieString(cookieMap);
        console.log('[WAF] finalizeResolve cookieMap:', JSON.stringify(cookieMap));
        console.log('[WAF] finalizeResolve cookie string:', cookies);

        const result: OpenWebViewResult = {
          data: '',
          cookies,
          cookieMap,
          url: req.url,
          userAgent: req.headers?.['User-Agent'] || '',
          expires: expiresAt || undefined,
        };
        req.resolve(result);
      } catch (e) {
        req.reject(
          e instanceof Error ? e : new Error('Failed to read cookies'),
        );
      } finally {
        remove(req.id);
        closeWebview();
      }
    },
    [remove, closeWebview, cleanup],
  );

  const cancel = useCallback(() => {
    if (!request || settledRef.current) return;
    settledRef.current = true;
    cleanup();
    request.reject(new Error('WAF_DIALOG_CANCELLED'));
    remove(request.id);
    closeWebview();
  }, [request, remove, closeWebview, cleanup]);

  const resolveWithPage = useCallback(() => {
    if (!request || settledRef.current) return;
    settledRef.current = true;
    finalizeResolve(request);
  }, [request, finalizeResolve]);

  // Open the webview when a new request arrives
  useEffect(() => {
    if (!request) {
      setVisible(false);
      return;
    }

    const openWebview = async () => {
      // Close any existing webview first
      const existing = await WebviewWindow.getByLabel(WAF_WEBVIEW_LABEL);
      if (existing) {
        try { await existing.destroy(); } catch { }
      }

      const customUserAgent = request.headers?.['User-Agent'] || request.headers?.['user-agent'];

      const webview = new WebviewWindow(WAF_WEBVIEW_LABEL, {
        url: request.url,
        title: request.title || 'Security Check - Please complete the challenge',
        width: 800,
        height: 600,
        center: true,
        userAgent: customUserAgent,
        incognito: true,
      });

      webviewRef.current = webview;

      webview.once('tauri://created', async () => {
        setVisible(true);
        // Snapshot existing cookies so we only auto-resolve on NEW ones
        try {
          const existing = await getCookiesForUrl(request.url);
          initialCookiesRef.current = new Set(Object.keys(existing));
        } catch { }
        webviewReadyRef.current = true;
      });

      webview.once('tauri://error', (e: any) => {
        console.error('WafDialog webview error:', e.payload);
        if (!settledRef.current) {
          settledRef.current = true;
          cleanup();
          request.reject(new Error(`WAF dialog failed: ${e.payload || 'Unknown'}`));
          remove(request.id);
        }
        setVisible(false);
      });

      // Closing the popup = cancel, like mobile's close button
      webview.onCloseRequested(() => {
        if (!settledRef.current) {
          cancel();
        }
      });
    };

    openWebview();

    return () => {
      cleanup();
    };
  }, [request?.id]);

  // Poll for the waitForCookie - exactly like mobile
  useEffect(() => {
    const cookieName = request?.waitForCookie;
    const url = request?.url;
    if (!cookieName || !url) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || settledRef.current || !webviewReadyRef.current) return;
      const cookieMap = await getCookiesForUrl(url);
      if (
        cookieMap[cookieName] &&
        !initialCookiesRef.current.has(cookieName)
      ) {
        console.log(`[WAF] cookie '${cookieName}' appeared! value:`, cookieMap[cookieName]);
        console.log('[WAF] all cookies:', JSON.stringify(cookieMap));
        console.log('[WAF] initial cookies were:', [...initialCookiesRef.current]);
        resolveWithPage();
      }
    };

    // Delay first poll to let webview load
    pollIntervalRef.current = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [request?.id, request?.waitForCookie, request?.url, resolveWithPage]);

  // Timeout
  useEffect(() => {
    if (!request?.timeoutMs) return;
    timeoutRef.current = setTimeout(() => cancel(), request.timeoutMs);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [request, cancel]);

  if (!request || !visible) return null;

  // Return null because the WAF solver uses an OS-level WebviewWindow
  // We don't need to show an overlay in the main application UI.
  return null;
};

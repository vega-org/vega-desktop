import React, { useEffect, useState } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useWafStore } from '../lib/zustand/wafStore';

export const WafDialog: React.FC = () => {
  const { requests, remove } = useWafStore();
  const [activeRequest, setActiveRequest] = useState<any>(null);

  useEffect(() => {
    if (!activeRequest && requests.length > 0) {
      const request = requests[0];
      setActiveRequest(request);
      handleWafChallenge(request);
    }
  }, [requests, activeRequest]);

  const handleWafChallenge = async (request: any) => {
    try {
      console.log('Opening WAF Solver for:', request.url);
      
      const webview = new WebviewWindow('waf-solver', {
        url: request.url,
        title: 'Security Check - Please complete the challenge',
        width: 800,
        height: 600,
        center: true,
      });

      webview.once('tauri://error', function (e) {
        console.error('WafDialog Error:', e);
        request.reject(new Error('Failed to open WAF dialog'));
        remove(request.id);
        setActiveRequest(null);
      });

      // Poll or wait for user to solve and close the window
      webview.onCloseRequested(async () => {
        console.log('WAF Solver closed');
        // Currently, extracting HTTP-only cookies directly from WebView is complex.
        // We resolve with empty cookies, hoping the Tauri HTTP plugin shares the cookie jar
        // or the challenge was just an IP-level unblock.
        request.resolve({
          data: '',
          cookies: '',
          cookieMap: {},
          url: request.url,
          userAgent: request.headers?.['User-Agent'] || '',
        });
        remove(request.id);
        setActiveRequest(null);
      });

    } catch (err) {
      request.reject(err);
      remove(request.id);
      setActiveRequest(null);
    }
  };

  return null; // This is a headless component that manages the WAF window
};

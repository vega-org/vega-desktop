import type {HostRequest, HostResponse, PlatformHost} from './host';
import {cookieHeader, decodeCookieJar, responseCookies, suppliedCookies} from '../lib/providers/cookieRules';

function installBackNavigation(backKeyCode: number): void {
  document.addEventListener('keydown', event => {
    if (event.keyCode !== backKeyCode && event.keyCode !== 27 && event.key !== 'Escape') return;
    // Player controls and dialogs get the first chance to consume Back.
    const dialogOpen = !!document.querySelector('[role="dialog"]');
    queueMicrotask(() => {
      if (!event.defaultPrevented && !dialogOpen && location.hash && location.hash !== '#/') {
        event.preventDefault();
        history.back();
      }
    });
  });
}

/** The webOS and Amazon wrappers serve packaged UI from an authenticated loopback host. */
export function installTvHost(): void {
  const kind = import.meta.env.VITE_TV_HOST;
  if (kind === 'tizen') {
    installBackNavigation(10009);
    // Normalize Samsung Back for components that already handle Escape.
    document.addEventListener('keydown', event => {
      if (event.keyCode !== 10009 || event.key === 'Escape') return;
      event.stopImmediatePropagation();
      const escape = new KeyboardEvent('keydown', {
        key:'Escape', code:'Escape', bubbles:true, cancelable:true, repeat:event.repeat,
      });
      const handled = !(event.target ?? document).dispatchEvent(escape);
      if (handled || (location.hash && location.hash !== '#/')) event.preventDefault();
    }, true);
    return;
  }
  if (kind !== 'webos' && kind !== 'amazon-vega') return;
  const match = location.pathname.match(/^\/app\/([a-f0-9]{64})\/index\.html$/);
  if (location.hostname !== '127.0.0.1' || location.protocol !== 'http:' || !match) {
    throw new Error('The installed TV app must be opened by its native host.');
  }
  const token = match[1];
  const rpc = async <T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(`/api/${method}`, {method:'POST', credentials:'omit', signal,
      headers:{'content-type':'application/json', 'x-vega-session':token}, body:JSON.stringify(payload)});
    if (!response.ok) throw new Error((await response.text()).slice(0, 500) || `TV host HTTP ${response.status}`);
    return response.json();
  };
  const request = async (input: HostRequest, signal: AbortSignal): Promise<HostResponse> => {
    let current = {...input, headers:[...input.headers]}, jar = suppliedCookies(
      decodeCookieJar({version:2, cookies:input.cookies || []}), input.url,
      input.headers.find(([key]) => key.toLowerCase() === 'cookie')?.[1] || '');
    const updates: NonNullable<HostResponse['cookieUpdates']> = [];
    for (let count = 0; count <= 10; count++) {
      const headers = current.headers.filter(([key]) => key.toLowerCase() !== 'cookie');
      const cookie = cookieHeader(jar, current.url); if (cookie) headers.push(['cookie', cookie]);
      const result = await rpc<HostResponse>('request', {...current, headers, redirect:'manual'}, signal);
      const setCookies = result.headers.filter(([key]) => key.toLowerCase() === 'set-cookie').map(([, value]) => value);
      jar = responseCookies(jar, result.url, setCookies);
      const target = result.headers.find(([key]) => key.toLowerCase() === 'location')?.[1];
      if (![301,302,303,307,308].includes(result.status) || !target || input.redirect === 'manual') return {...result, cookieUpdates:updates};
      if (input.redirect === 'error') throw new Error('Provider redirect was refused.');
      if (count === 10) throw new Error('Too many provider redirects.');
      if (setCookies.length) updates.push({url:result.url, headers:setCookies});
      const next = new URL(target, result.url);
      if (new URL(current.url).origin !== next.origin) current.headers = current.headers.filter(([name]) =>
        /^(accept|accept-language|user-agent|referer|origin|range|sec-ch-ua(?:-mobile|-platform)?)$/i.test(name));
      if (result.status === 303 && current.method !== 'HEAD' || [301,302].includes(result.status) && current.method === 'POST') {
        current = {...current, method:'GET', body:undefined, headers:current.headers.filter(([name]) => !/^content-/i.test(name))};
      }
      current.url = next.href;
    }
    throw new Error('Too many redirects');
  };
  const host: PlatformHost = {version:1, kind,
    capabilities:{restrictedHeaders:true, isolatedCookies:true, manualRedirects:true, mediaDelivery:true, publicDestinationChecks:true},
    request, prepareMediaSource:source => rpc('prepare', source), releaseMediaSource:async id => {await rpc('release', {id});}};
  Object.defineProperty(window, 'vegaPlatformHost', {value:host, configurable:false, writable:false});
  // Keeps the webOS service alive while the app is open, also expires abandoned playback leases.
  const heartbeat = setInterval(() => {void rpc('heartbeat', {}).catch(() => {});}, 20_000);
  window.addEventListener('pagehide', () => clearInterval(heartbeat), {once:true});
  installBackNavigation(461);
}

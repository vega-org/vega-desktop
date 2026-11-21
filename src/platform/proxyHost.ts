import type {PlatformHost, HostRequest} from './host';

const preferenceKey = 'vega_web_proxy_enabled';
export function proxyEnabled(): boolean {
  try {return localStorage.getItem(preferenceKey) === 'true';} catch {return false;}
}
export function enableProxy(): void {
  localStorage.setItem(preferenceKey, 'true');
  window.dispatchEvent(new Event('vega-platform-host-change'));
}

async function proxyCall(path: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/proxy/${path}`, {
    method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body), signal,
  });
  if (response.headers.get('cf-mitigated') === 'challenge') {
    throw new Error('Vega verification expired. Reload Vega to complete verification, then retry.');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The Vega proxy is unavailable. Reload to complete website verification or install the extension.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The Vega proxy request failed.');
  return result;
}

// Serialize initial cookie creation when the app starts several provider calls.
let creatingSession: Promise<unknown> | undefined;
async function ensureSession(signal?: AbortSignal) {
  if (!creatingSession) {
    creatingSession = proxyCall('session', {}).finally(() => {creatingSession = undefined;});
  }
  await creatingSession;
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
}

export const proxyHost: PlatformHost = {
  version: 1, kind: 'hosted-proxy',
  capabilities: {publicDestinationChecks: true, restrictedHeaders: true, isolatedCookies: true, manualRedirects: true, mediaDelivery: true},
  async request(request: HostRequest, signal) {
    await ensureSession(signal);
    return proxyCall('request', request, signal);
  },
  async prepareMediaSource(source) {
    await ensureSession();
    const result = await proxyCall('prepare', {url: source.source, headers: Object.entries(source.headers || {}), format: source.format});
    const resolvedUrl = typeof window !== 'undefined' && window.location?.origin
      ? new URL(result.url, window.location.origin).href
      : result.url;
    return {...source, source: resolvedUrl, headers: undefined};
  },
};

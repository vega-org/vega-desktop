import {proxyEnabled, proxyHost} from './proxyHost';
import type {MediaSourceDescriptor} from '@vega/libmedia-engine/core/media';
import type {StoredCookie} from '../lib/providers/cookieRules';
import type {JarCookie} from '../lib/providers/cookieRules';

export interface ProviderVerificationRequest {url: string; scope: string; waitForCookie?: string; timeoutMs?: number}
export interface ProviderVerificationResult {url: string; userAgent: string; cookie: JarCookie}

export interface HostCapabilities {
  /** URL/DNS destination checks on requests, redirects and prepared resources. */
  publicDestinationChecks?: boolean;
  restrictedHeaders: boolean;
  isolatedCookies: boolean;
  manualRedirects: boolean;
  mediaDelivery: boolean;
}

/** Serializable HTTP contract. Platform wrappers own bus/message encoding. */
export interface HostRequest {
  url: string;
  method: string;
  headers: [string, string][];
  body?: number[];
  redirect: RequestRedirect;
  credentials: 'omit';
  /** Provider source author; never use another author's or profile cookies. */
  scope?: string;
  /** This source author's jar, for reselecting cookies at each redirect URL. */
  cookies?: StoredCookie[];
}

export interface HostResponse {
  url: string;
  status: number;
  statusText?: string;
  headers: [string, string][];
  body: number[];
  /** Intermediate responses, retaining their actual URL for cookie scope. */
  cookieUpdates?: {url: string; headers: string[]}[];
}

export interface PlatformHost {
  version: 1;
  kind: 'browser-extension' | 'hosted-proxy' | 'webos' | 'amazon-vega';
  capabilities: HostCapabilities;
  request?: (request: HostRequest, signal: AbortSignal) => Promise<HostResponse>;
  verifyProvider?: (request: ProviderVerificationRequest, signal: AbortSignal) => Promise<ProviderVerificationResult>;
  /** Prepare the entire delivery chain, including child playlists and keys. */
  prepareMediaSource?: (source: MediaSourceDescriptor) => Promise<MediaSourceDescriptor>;
  /** Release prepared URLs/rules when switching source, closing or reading subtitles. */
  releaseMediaSource?: (id: string) => Promise<void>;
}

declare global {
  interface Window {__vegaBrowserBridge?: boolean; vegaPlatformHost?: PlatformHost; vegaPlatformHostReady?: Promise<void>}
}

export function isBrowserExtensionInstalled(): boolean {
  return typeof window !== 'undefined' && (window.__vegaBrowserBridge === true || window.vegaPlatformHost?.kind === 'browser-extension');
}

export function isBrowserExtensionPermissionMissing(): boolean {
  if (isTauriRuntime() || import.meta.env?.VITE_TV_HOST || !isBrowserExtensionInstalled()) return false;
  return typeof window === 'undefined' || window.vegaPlatformHost?.kind !== 'browser-extension';
}

/** An injected host may still be authorizing its document at app startup. */
export async function waitForPlatformHost(): Promise<void> {
  if (typeof window === 'undefined' || !window.vegaPlatformHostReady) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {await Promise.race([window.vegaPlatformHostReady, new Promise<void>(resolve => {timeout = setTimeout(resolve, 2000);})]);}
  finally {clearTimeout(timeout);}
}

/** TV wrappers currently provide playback networking, not file downloads. */
export function supportsMediaDownloads(): boolean {
  const kind = import.meta.env.VITE_TV_HOST || window.vegaPlatformHost?.kind;
  return kind !== 'webos' && kind !== 'amazon-vega' && kind !== 'tizen';
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getPlatformHost(): PlatformHost | undefined {
  const host = typeof window === 'undefined' ? undefined : window.vegaPlatformHost;
  if (!host) {
    if (isBrowserExtensionInstalled()) return undefined;
    return !isTauriRuntime() && !import.meta.env?.VITE_TV_HOST && proxyEnabled() ? proxyHost : undefined;
  }
  if (host.version !== 1 || !host.capabilities || !['browser-extension', 'webos', 'amazon-vega'].includes(host.kind) ||
      ['restrictedHeaders', 'isolatedCookies', 'manualRedirects', 'mediaDelivery'].some(key => typeof host.capabilities[key as keyof HostCapabilities] !== 'boolean') ||
      (host.capabilities.publicDestinationChecks !== undefined && typeof host.capabilities.publicDestinationChecks !== 'boolean') ||
      (host.request !== undefined && typeof host.request !== 'function') ||
      (host.verifyProvider !== undefined && typeof host.verifyProvider !== 'function') ||
      (host.releaseMediaSource !== undefined && typeof host.releaseMediaSource !== 'function') ||
      (host.capabilities.mediaDelivery && typeof host.prepareMediaSource !== 'function')) {
    throw new Error('Unsupported Vega platform host bridge');
  }
  return host;
}

export function requirePublicDestinationChecks(host: PlatformHost): void {
  if (host.capabilities.publicDestinationChecks !== true) throw new Error(`This platform host is missing provider destination checks. ${host.kind === 'browser-extension' ? 'Update the Vega extension to 0.4.0 or later.' : 'Update the installed app host to support checked provider destinations.'}`);
}

export class PlatformAccessError extends Error {
  constructor(readonly code: 'HOST_REQUIRED' | 'COOKIE_ISOLATION_REQUIRED' | 'INVALID_HOST_RESPONSE', message: string) {
    super(message);
    this.name = 'PlatformAccessError';
  }
}

export function assertBrowserHeaders(headers: Headers): void {
  for (const key of headers.keys()) {
    if (/^(accept-charset|accept-encoding|access-control-request-.*|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|referer|set-cookie|te|trailer|transfer-encoding|upgrade|user-agent|via|sec-.*|proxy-.*)$/i.test(key)) {
      throw new PlatformAccessError('HOST_REQUIRED', `The ${key} header requires platform-managed networking. Use an installed app host or a browser networking bridge.`);
    }
  }
}

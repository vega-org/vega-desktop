import axios from 'axios';
import { getBaseUrl } from './getBaseUrl';
import { headers } from './headers';
import * as cheerio from 'cheerio';
import { ProviderContext } from './types';
import { Crypto } from '../../platform/crypto';
import { openWebView } from '../../platform/waf';
import { tauriAxiosAdapter } from './tauriAxiosAdapter';

// Force all axios requests to go through the Tauri Rust backend.
// This completely bypasses the browser's CORS restrictions and allows us to spoof
// forbidden headers like 'Referer' and 'User-Agent'.
axios.defaults.adapter = tauriAxiosAdapter;

/**
 * Context for provider functions.
 * This context is used to pass common dependencies to provider functions.
 */
export const providerContext: ProviderContext = {
  axios,
  getBaseUrl,
  commonHeaders: headers,
  Crypto,
  cheerio,
  openWebView,
};

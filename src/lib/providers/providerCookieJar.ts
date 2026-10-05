import {providerAuthor} from './providerScope';

/**
 * Cookie jar for provider requests, one per source author. Provider requests
 * never use the shared HTTP client cookie store, so cookies set for one author's
 * providers (including WAF clearance cookies) are never sent or shown to
 * another author's providers.
 *
 * Kept simple: cookies match by domain only (path and Secure are ignored).
 */

interface StoredCookie {
  value: string;
  /** Unix time in ms, or null for no expiry. */
  expiresAt: number | null;
  /** Sent only to the exact host, not its subdomains. */
  hostOnly: boolean;
}

/** domain -> cookie name -> cookie */
type AuthorJar = Record<string, Record<string, StoredCookie>>;

export interface JarCookie {
  name: string;
  value: string;
  /** Domain attribute; host-only when missing. */
  domain?: string;
  /** Unix time in ms. */
  expiresAt?: number | null;
}

const MAX_COOKIES_PER_AUTHOR = 500;
const STORAGE_PREFIX = 'vega_provider_cookies:';

const storage = {
  getString(author: string): string | null {
    try {
      return localStorage.getItem(STORAGE_PREFIX + author);
    } catch {
      return null;
    }
  },
  setString(author: string, value: string): void {
    try {
      localStorage.setItem(STORAGE_PREFIX + author, value);
    } catch (error) {
      console.warn('Failed to save provider cookies:', error);
    }
  },
  delete(author: string): void {
    try {
      localStorage.removeItem(STORAGE_PREFIX + author);
    } catch {
      // ignore
    }
  },
};

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const readJar = (author: string): AuthorJar => {
  const raw = storage.getString(author);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as AuthorJar) : {};
  } catch {
    return {};
  }
};

const writeJar = (author: string, jar: AuthorJar): void => {
  const now = Date.now();
  let count = 0;
  for (const domain of Object.keys(jar)) {
    for (const name of Object.keys(jar[domain])) {
      const cookie = jar[domain][name];
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
        delete jar[domain][name];
      } else if (++count > MAX_COOKIES_PER_AUTHOR) {
        delete jar[domain][name];
      }
    }
    if (Object.keys(jar[domain]).length === 0) {
      delete jar[domain];
    }
  }
  if (Object.keys(jar).length === 0) {
    storage.delete(author);
  } else {
    storage.setString(author, JSON.stringify(jar));
  }
};

const domainMatches = (host: string, domain: string, hostOnly: boolean) =>
  host === domain || (!hostOnly && host.endsWith(`.${domain}`));

const putCookies = (
  authorRaw: string | undefined,
  url: string,
  cookies: JarCookie[],
): void => {
  const host = hostOf(url);
  if (!host || cookies.length === 0) {
    return;
  }
  const author = providerAuthor(authorRaw);
  const jar = readJar(author);
  for (const cookie of cookies) {
    if (!cookie.name) {
      continue;
    }
    const attrDomain = cookie.domain?.trim().toLowerCase().replace(/^\./, '');
    // A Domain attribute must cover the host that set it.
    if (attrDomain && !domainMatches(host, attrDomain, false)) {
      continue;
    }
    const domain = attrDomain || host;
    const expired =
      cookie.expiresAt != null && cookie.expiresAt <= Date.now();
    // A cookie replaces (or, when expired, removes) any same-named one this
    // host can see.
    for (const d of Object.keys(jar)) {
      if (domainMatches(host, d, false)) {
        delete jar[d][cookie.name];
      }
    }
    if (!expired) {
      jar[domain] = jar[domain] ?? {};
      jar[domain][cookie.name] = {
        value: cookie.value,
        expiresAt: cookie.expiresAt ?? null,
        hostOnly: !attrDomain,
      };
    }
  }
  writeJar(author, jar);
};

/** Parses one Set-Cookie header value. */
const parseSetCookie = (header: string): JarCookie | undefined => {
  const [pair, ...attributes] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) {
    return undefined;
  }
  const cookie: JarCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
  };
  let maxAge: number | undefined;
  for (const attribute of attributes) {
    const i = attribute.indexOf('=');
    const key = (i < 0 ? attribute : attribute.slice(0, i)).trim().toLowerCase();
    const value = i < 0 ? '' : attribute.slice(i + 1).trim();
    if (key === 'domain' && value) {
      cookie.domain = value;
    } else if (key === 'max-age' && /^-?\d+$/.test(value)) {
      maxAge = Number(value);
    } else if (key === 'expires') {
      const time = Date.parse(value);
      if (!isNaN(time)) {
        cookie.expiresAt = time;
      }
    }
  }
  if (maxAge !== undefined) {
    cookie.expiresAt = Date.now() + maxAge * 1000;
  }
  return cookie;
};

/**
 * Splits Set-Cookie values that were joined with commas, without splitting
 * the comma inside an Expires date.
 */
const splitSetCookie = (value: string): string[] =>
  value.split(/,(?=\s*[^;,\s]+=)/).map(part => part.trim()).filter(Boolean);

/** Name -> value map of this author's cookies for the URL. */
export const getJarCookieMap = (
  author: string | undefined,
  url: string,
): Record<string, string> => {
  const host = hostOf(url);
  const map: Record<string, string> = {};
  if (!host) {
    return map;
  }
  const now = Date.now();
  const jar = readJar(providerAuthor(author));
  for (const domain of Object.keys(jar)) {
    for (const [name, cookie] of Object.entries(jar[domain])) {
      if (
        domainMatches(host, domain, cookie.hostOnly) &&
        (cookie.expiresAt === null || cookie.expiresAt > now)
      ) {
        map[name] = cookie.value;
      }
    }
  }
  return map;
};

const toHeader = (map: Record<string, string>): string =>
  Object.entries(map)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

const parseCookieHeader = (header: string): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      map[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return map;
};

/** Cookie header of this author's cookies for the URL ('' when none). */
export const getJarCookieHeader = (
  author: string | undefined,
  url: string,
): string => toHeader(getJarCookieMap(author, url));

/**
 * Cookie header for a provider request: the jar's cookies plus the ones the
 * provider set itself, which win on a name clash. The provider's cookies are
 * saved to its author's jar so later requests send them too.
 */
export const buildRequestCookieHeader = (
  author: string | undefined,
  url: string,
  supplied?: string,
): string => {
  if (supplied) {
    const map = parseCookieHeader(supplied);
    putCookies(
      author,
      url,
      Object.entries(map).map(([name, value]) => ({name, value})),
    );
    const jar = getJarCookieMap(author, url);
    for (const name of Object.keys(map)) {
      delete jar[name];
    }
    return toHeader({...map, ...jar});
  }
  return getJarCookieHeader(author, url);
};

/** Saves Set-Cookie header values from a response to this author's jar. */
export const storeSetCookies = (
  author: string | undefined,
  url: string,
  headers: string[],
): void => {
  const cookies: JarCookie[] = [];
  for (const header of headers) {
    for (const part of splitSetCookie(header)) {
      const cookie = parseSetCookie(part);
      if (cookie) {
        cookies.push(cookie);
      }
    }
  }
  putCookies(author, url, cookies);
};

/** Saves cookies read from the WAF solver window to this author's jar. */
export const storeJarCookies = (
  author: string | undefined,
  url: string,
  cookies: JarCookie[],
): void => putCookies(author, url, cookies);

/** Removes a cookie of this author for the URL. */
export const deleteJarCookie = (
  authorRaw: string | undefined,
  url: string,
  name: string,
): void => {
  const host = hostOf(url);
  if (!host) {
    return;
  }
  const author = providerAuthor(authorRaw);
  const jar = readJar(author);
  for (const domain of Object.keys(jar)) {
    if (domainMatches(host, domain, false)) {
      delete jar[domain][name];
    }
  }
  writeJar(author, jar);
};

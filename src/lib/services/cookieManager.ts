// Case-insensitive lookup of the User-Agent from a headers object.
export const pickUserAgent = (
  h?: Record<string, string>,
): string | undefined => {
  if (!h) {
    return undefined;
  }
  const key = Object.keys(h).find(k => k.toLowerCase() === 'user-agent');
  return key ? h[key] : undefined;
};

interface NativeCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: string;
}

export const getCookieObjects = async (
  _url: string,
): Promise<NativeCookie[]> => {
  console.warn('[cookieManager] Desktop getCookieObjects not fully implemented yet');
  return [];
};

// Reads cookies for `url` as a name -> value map.
export const getCookies = async (
  url: string,
): Promise<Record<string, string>> => {
  const objects = await getCookieObjects(url);
  const map: Record<string, string> = {};
  for (const cookie of objects) {
    map[cookie.name] = cookie.value;
  }
  return map;
};

// Builds a Cookie header value from a name -> value map.
export const buildCookieString = (map: Record<string, string>): string =>
  Object.entries(map)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

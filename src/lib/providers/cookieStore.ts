// LocalStorage based cookie store that respects expiry

interface StoredCookie {
  cookieString: string;
  expiresAt: number | null; // Unix timestamp in milliseconds
}

export function updateGlobalCookies(domain: string, cookieString: string, expires?: number | null) {
  try {
    const data: StoredCookie = {
      cookieString,
      expiresAt: expires ? expires * 1000 : null, // Convert from seconds if necessary
    };
    localStorage.setItem(`vega_waf_cookie_${domain}`, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save cookie to localStorage', e);
  }
}

export function getGlobalCookies(url: string): string | undefined {
  try {
    const domain = new URL(url).origin;
    const raw = localStorage.getItem(`vega_waf_cookie_${domain}`);
    if (!raw) return undefined;
    
    const data: StoredCookie = JSON.parse(raw);
    
    // Check expiry
    if (data.expiresAt && Date.now() > data.expiresAt) {
      localStorage.removeItem(`vega_waf_cookie_${domain}`);
      return undefined;
    }
    
    return data.cookieString;
  } catch {
    return undefined;
  }
}

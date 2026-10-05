import { extensionStorage } from "../storage/extensionStorage";

/**
 * Provider data (kvStore, state, cookies) is kept per source author, so a
 * provider from one source can never read what a provider from another source
 * saved, even when both use the same provider value.
 */

/** Author used for providers without a source, such as dev server modules. */
export const LOCAL_AUTHOR = "local";

export const KV_PREFIX = "vega_provider_kv:";

export const providerAuthor = (author?: string | null): string =>
  author?.trim() || LOCAL_AUTHOR;

/**
 * Storage id of one provider of one author. Both parts are URI encoded, so the
 * id never contains ':' and one provider's key prefix cannot match another's.
 */
export const providerScopeId = (
  author: string | undefined | null,
  providerValue: string,
): string =>
  `${encodeURIComponent(providerAuthor(author))}/${encodeURIComponent(providerValue)}`;

export const getProviderPrefix = (
  author: string | undefined | null,
  providerValue: string,
): string => `${KV_PREFIX}${providerScopeId(author, providerValue)}:`;

export const getScopedKvKey = (
  author: string | undefined | null,
  providerValue: string,
  key: string,
): string => `${getProviderPrefix(author, providerValue)}${key}`;

const MIGRATED_KEY = "provider-kv-scoped-by-author";

/**
 * Moves kvStore keys saved before scoping ("value:key") to "author/value:key".
 * A value installed from several sources already shared one store, so each of
 * those authors gets a copy. Keys of providers that are no longer installed
 * are dropped, as are the old shared WAF cookies. Runs once.
 */
export const migrateLegacyProviderData = (): void => {
  try {
    if (localStorage.getItem(MIGRATED_KEY) === "true") return;

    const authorsByValue = new Map<string, Set<string>>();
    for (const provider of extensionStorage.getInstalledProviders()) {
      const authors = authorsByValue.get(provider.value) ?? new Set<string>();
      authors.add(providerAuthor(provider.source?.author));
      authorsByValue.set(provider.value, authors);
    }
    // Longest value first, so "a:b:key" goes to provider "a:b", not "a".
    const values = Array.from(authorsByValue.keys()).sort(
      (a, b) => b.length - a.length,
    );

    const oldKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("vega_waf_cookie_")) {
        oldKeys.push(key);
        continue;
      }
      if (!key.startsWith(KV_PREFIX)) continue;
      const rest = key.slice(KV_PREFIX.length);
      const colon = rest.indexOf(":");
      // Scoped keys have "/" before the first ":"; leave them alone.
      if (colon > 0 && !rest.slice(0, colon).includes("/")) {
        oldKeys.push(key);
      }
    }

    for (const oldKey of oldKeys) {
      const raw = localStorage.getItem(oldKey);
      if (oldKey.startsWith(KV_PREFIX) && raw !== null) {
        const rest = oldKey.slice(KV_PREFIX.length);
        const value = values.find((v) => rest.startsWith(`${v}:`));
        if (value) {
          const key = rest.slice(value.length + 1);
          for (const author of authorsByValue.get(value) ?? []) {
            localStorage.setItem(getScopedKvKey(author, value, key), raw);
          }
        }
      }
      localStorage.removeItem(oldKey);
    }
    localStorage.setItem(MIGRATED_KEY, "true");
  } catch (error) {
    console.warn("Failed to migrate provider storage:", error);
  }
};

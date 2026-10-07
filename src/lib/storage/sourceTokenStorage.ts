import {StorageService} from './StorageService';

// GitHub tokens for private provider sources, keyed by source author. Kept
// under their own storage prefix, away from source data. Provider code runs
// in the sandbox worker, which has no access to localStorage.
const RAW_GITHUB_ORIGIN = 'https://raw.githubusercontent.com/';
const MAX_TOKEN_LENGTH = 255;

const storage = new StorageService('provider-source-tokens');

export const normalizeSourceToken = (token: string): string | undefined => {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH || /\s/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
};

export const sourceTokenStorage = {
  get(author: string): string | undefined {
    return storage.getString(author) || undefined;
  },

  set(author: string, token: string): void {
    storage.setString(author, token);
  },

  delete(author: string): void {
    storage.delete(author);
  },

  has(author: string): boolean {
    return Boolean(this.get(author));
  },
};

/**
 * True when a token of this source may go to the URL: any
 * raw.githubusercontent.com file, or for a custom source (author key
 * "host/folder") only files under its own https folder. A token never reaches
 * another host or another site's folder.
 */
export const isSourceAuthUrl = (author: string, url: string): boolean =>
  url.startsWith(RAW_GITHUB_ORIGIN) || url.startsWith(`https://${author}/`);

/** Auth header for a provider source file. */
export const getSourceAuthHeaders = (
  author: string | undefined,
  url: string,
): Record<string, string> => {
  if (!author || !isSourceAuthUrl(author, url)) {
    return {};
  }
  const token = sourceTokenStorage.get(author);
  return token ? {Authorization: `token ${token}`} : {};
};

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
 * Auth header for a provider source file. Sent only to raw.githubusercontent.com,
 * so a token never reaches another host.
 */
export const getSourceAuthHeaders = (
  author: string | undefined,
  url: string,
): Record<string, string> => {
  if (!author || !url.startsWith(RAW_GITHUB_ORIGIN)) {
    return {};
  }
  const token = sourceTokenStorage.get(author);
  return token ? {Authorization: `token ${token}`} : {};
};

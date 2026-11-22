/**
 * Interface for the StorageService class
 */
export interface IStorageService {
  getString(key: string): string | undefined;
  setString(key: string, value: string): void;
  getBool(key: string, defaultValue?: boolean): boolean;
  setBool(key: string, value: boolean): void;
  getNumber(key: string): number | undefined;
  setNumber(key: string, value: number): void;
  getObject<T>(key: string): T | undefined;
  setObject<T>(key: string, value: T): void;
  getArray<T>(key: string): T[] | undefined;
  setArray<T>(key: string, value: T[]): void;
  delete(key: string): void;
  contains(key: string): boolean;
  getKeys(): string[];
  clearAll(): void;
}

/**
 * Base storage service that wraps localStorage operations
 */
export class StorageService implements IStorageService {
  private prefix: string;
  private cacheWriteWarningReported = false;

  constructor(instanceId?: string) {
    this.prefix = instanceId ? `${instanceId}_` : '';
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  // String operations
  getString(key: string): string | undefined {
    return localStorage.getItem(this.getKey(key)) || undefined;
  }

  setString(key: string, value: string): void {
    const fullKey = this.getKey(key);
    try {
      localStorage.setItem(fullKey, value);
      return;
    } catch (error) {
      let failure = error;
      const storageError = error as {name?: string; code?: number} | null;
      const quotaExceeded = storageError && (
        storageError.name === 'QuotaExceededError' ||
        storageError.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        storageError.code === 22 || storageError.code === 1014
      );
      if (quotaExceeded) {
        try {
          // Cache and durable data share the origin's quota. Evict only
          // disposable cache entries, never settings, history or provider data.
          const cacheKeys: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const cachedKey = localStorage.key(i);
            if (cachedKey?.startsWith('cache_')) cacheKeys.push(cachedKey);
          }
          if (cacheKeys.length > 0) {
            cacheKeys.forEach(cachedKey => localStorage.removeItem(cachedKey));
            localStorage.setItem(fullKey, value);
            return;
          }
        } catch (retryError) {
          failure = retryError;
        }
      }
      if (this.prefix === 'cache_') {
        // A cache entry can exceed the entire quota, or storage can be denied.
        // Fetched data is still usable; optional persistence must not crash React.
        if (!this.cacheWriteWarningReported) {
          console.warn('[Storage] Cache persistence unavailable; continuing without it.', failure);
          this.cacheWriteWarningReported = true;
        }
        return;
      }
      // Never silently report success when saving durable user data failed.
      throw failure;
    }
  }

  // Boolean operations
  getBool(key: string, defaultValue?: boolean): boolean {
    const value = localStorage.getItem(this.getKey(key));
    if (value === null) {
      return defaultValue || false;
    }
    return value === 'true';
  }

  setBool(key: string, value: boolean): void {
    this.setString(key, value ? 'true' : 'false');
  }

  // Number operations
  getNumber(key: string): number | undefined {
    const value = localStorage.getItem(this.getKey(key));
    if (value === null) return undefined;
    const num = Number(value);
    return isNaN(num) ? undefined : num;
  }

  setNumber(key: string, value: number): void {
    this.setString(key, String(value));
  }

  // Object operations
  getObject<T>(key: string): T | undefined {
    const json = localStorage.getItem(this.getKey(key));
    if (!json) {
      return undefined;
    }
    try {
      return JSON.parse(json) as T;
    } catch (e) {
      console.error(`Failed to parse stored object for key ${key}:`, e);
      return undefined;
    }
  }

  setObject<T>(key: string, value: T): void {
    this.setString(key, JSON.stringify(value));
  }

  // Array operations
  getArray<T>(key: string): T[] | undefined {
    return this.getObject<T[]>(key);
  }

  setArray<T>(key: string, value: T[]): void {
    this.setObject(key, value);
  }

  // Delete operations
  delete(key: string): void {
    localStorage.removeItem(this.getKey(key));
  }

  // Check if key exists
  contains(key: string): boolean {
    return localStorage.getItem(this.getKey(key)) !== null;
  }

  getKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!this.prefix) keys.push(k);
      else if (k.startsWith(this.prefix)) keys.push(k.slice(this.prefix.length));
    }
    return keys;
  }

  // Clear all storage
  clearAll(): void {
    if (!this.prefix) {
      localStorage.clear();
      return;
    }
    
    // Only clear items with this prefix
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.prefix)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  }
}

// Create and export default instances
export const mainStorage: IStorageService = new StorageService();
export const cacheStorage: IStorageService = new StorageService('cache');

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
  clearAll(): void;
}

/**
 * Base storage service that wraps localStorage operations
 */
export class StorageService implements IStorageService {
  private prefix: string;

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
    localStorage.setItem(this.getKey(key), value);
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
    localStorage.setItem(this.getKey(key), value ? 'true' : 'false');
  }

  // Number operations
  getNumber(key: string): number | undefined {
    const value = localStorage.getItem(this.getKey(key));
    if (value === null) return undefined;
    const num = Number(value);
    return isNaN(num) ? undefined : num;
  }

  setNumber(key: string, value: number): void {
    localStorage.setItem(this.getKey(key), String(value));
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
    localStorage.setItem(this.getKey(key), JSON.stringify(value));
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

export interface CacheEntry {
  annotations: Record<string, unknown>;
  filtered: boolean;
  cachedAt: number;
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  clear(): Promise<void>;
}

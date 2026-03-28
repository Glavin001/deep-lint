import { readFile, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { CacheStore, CacheEntry } from "./cache-store.js";

export interface FsCacheStoreOptions {
  cacheDir: string;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class FsCacheStore implements CacheStore {
  private readonly cacheDir: string;
  private readonly ttlMs: number;

  constructor(options: FsCacheStoreOptions) {
    this.cacheDir = options.cacheDir;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  private entryPath(key: string): string {
    // Shard by first 2 chars like git objects
    const shard = key.slice(0, 2);
    return join(this.cacheDir, shard, `${key}.json`);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    try {
      const data = await readFile(this.entryPath(key), "utf-8");
      const entry: CacheEntry = JSON.parse(data);

      // TTL check
      if (Date.now() - entry.cachedAt > this.ttlMs) {
        return undefined;
      }

      return entry;
    } catch {
      return undefined;
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const filePath = this.entryPath(key);
    const dir = join(this.cacheDir, key.slice(0, 2));
    await mkdir(dir, { recursive: true });

    // Atomic write: write to temp file, then rename
    const tmpPath = filePath + "." + randomBytes(4).toString("hex") + ".tmp";
    await writeFile(tmpPath, JSON.stringify(entry), "utf-8");
    await rename(tmpPath, filePath);
  }

  async clear(): Promise<void> {
    await rm(this.cacheDir, { recursive: true, force: true });
  }
}

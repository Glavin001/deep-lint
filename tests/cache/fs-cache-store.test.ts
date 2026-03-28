import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FsCacheStore } from "../../src/cache/fs-cache-store.js";
import { rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { CacheEntry } from "../../src/cache/cache-store.js";

function tmpCacheDir(): string {
  return join(tmpdir(), `deep-lint-test-cache-${randomBytes(4).toString("hex")}`);
}

describe("FsCacheStore", () => {
  let cacheDir: string;
  let store: FsCacheStore;

  beforeEach(() => {
    cacheDir = tmpCacheDir();
    store = new FsCacheStore({ cacheDir });
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  const entry: CacheEntry = {
    annotations: { llmVerdict: true, llmConfidence: 0.9, llmReasoning: "test" },
    filtered: false,
    cachedAt: Date.now(),
  };

  it("returns undefined for missing key", async () => {
    expect(await store.get("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves entry", async () => {
    await store.set("abc123def456", entry);
    const result = await store.get("abc123def456");
    expect(result).toEqual(entry);
  });

  it("shards files by first 2 chars of key", async () => {
    await store.set("ab1234", entry);
    const shards = await readdir(cacheDir);
    expect(shards).toContain("ab");
  });

  it("overwrites existing entry", async () => {
    await store.set("key1", entry);
    const updated: CacheEntry = { ...entry, filtered: true };
    await store.set("key1", updated);
    const result = await store.get("key1");
    expect(result?.filtered).toBe(true);
  });

  it("returns undefined for expired entries", async () => {
    const shortTtlStore = new FsCacheStore({ cacheDir, ttlMs: 1 });
    const oldEntry: CacheEntry = { ...entry, cachedAt: Date.now() - 100 };
    await shortTtlStore.set("expired", oldEntry);
    expect(await shortTtlStore.get("expired")).toBeUndefined();
  });

  it("does not expire entries within TTL", async () => {
    const recentEntry: CacheEntry = { ...entry, cachedAt: Date.now() };
    await store.set("recent", recentEntry);
    expect(await store.get("recent")).toEqual(recentEntry);
  });

  it("clear removes the cache directory", async () => {
    await store.set("key1", entry);
    await store.clear();
    expect(await store.get("key1")).toBeUndefined();
  });

  it("handles multiple keys in same shard", async () => {
    await store.set("ab0001", entry);
    await store.set("ab0002", { ...entry, filtered: true });
    expect((await store.get("ab0001"))?.filtered).toBe(false);
    expect((await store.get("ab0002"))?.filtered).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FsCacheStore } from "../../src/cache/fs-cache-store.js";
import { rm, readdir, writeFile, mkdir } from "node:fs/promises";
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

  it("returns undefined for corrupted cache file (invalid JSON)", async () => {
    // Write a valid entry first, then corrupt it
    await store.set("corrupt01", entry);
    // Overwrite with invalid JSON
    const shard = join(cacheDir, "co");
    await writeFile(join(shard, "corrupt01.json"), "{invalid json!!!", "utf-8");
    expect(await store.get("corrupt01")).toBeUndefined();
  });

  it("returns undefined for empty cache file", async () => {
    await store.set("empty001", entry);
    const shard = join(cacheDir, "em");
    await writeFile(join(shard, "empty001.json"), "", "utf-8");
    expect(await store.get("empty001")).toBeUndefined();
  });

  it("handles concurrent writes to the same key", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      store.set("concurrent", { ...entry, cachedAt: Date.now() + i }),
    );
    await Promise.all(promises);
    const result = await store.get("concurrent");
    expect(result).toBeDefined();
    expect(result!.annotations).toEqual(entry.annotations);
    expect(result!.filtered).toBe(false);
  });

  it("handles concurrent writes to different keys", async () => {
    const promises = Array.from({ length: 20 }, (_, i) =>
      store.set(`key${String(i).padStart(4, "0")}`, { ...entry, cachedAt: Date.now() + i }),
    );
    await Promise.all(promises);

    for (let i = 0; i < 20; i++) {
      const result = await store.get(`key${String(i).padStart(4, "0")}`);
      expect(result).toBeDefined();
    }
  });

  it("stores and retrieves entry with empty annotations", async () => {
    const emptyAnnotations: CacheEntry = {
      annotations: {},
      filtered: false,
      cachedAt: Date.now(),
    };
    await store.set("emptyann", emptyAnnotations);
    const result = await store.get("emptyann");
    expect(result).toEqual(emptyAnnotations);
    expect(result!.annotations).toEqual({});
  });

  it("clear is idempotent (safe to call when directory doesn't exist)", async () => {
    await store.clear();
    await store.clear(); // second clear should not throw
    expect(await store.get("anything")).toBeUndefined();
  });
});

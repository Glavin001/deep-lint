import { describe, it, expect } from "vitest";
import { isCacheableStage, type Stage, type CacheableStage } from "../../src/core/stage.js";
import type { Candidate } from "../../src/core/candidate.js";

describe("isCacheableStage", () => {
  it("returns true for stages with computeCacheKey method", () => {
    const cacheableStage: CacheableStage = {
      name: "test-cacheable",
      computeCacheKey: () => "key",
      process: async (c) => c,
    };
    expect(isCacheableStage(cacheableStage)).toBe(true);
  });

  it("returns false for plain stages without computeCacheKey", () => {
    const plainStage: Stage = {
      name: "test-plain",
      process: async (c) => c,
    };
    expect(isCacheableStage(plainStage)).toBe(false);
  });

  it("returns false when computeCacheKey is not a function", () => {
    const stage = {
      name: "bad",
      process: async (c: Candidate[]) => c,
      computeCacheKey: "not a function",
    } as unknown as Stage;
    expect(isCacheableStage(stage)).toBe(false);
  });

  it("returns false for objects with only a name property", () => {
    const minimal = {
      name: "minimal",
      process: async (c: Candidate[]) => c,
    } as Stage;
    expect(isCacheableStage(minimal)).toBe(false);
  });
});

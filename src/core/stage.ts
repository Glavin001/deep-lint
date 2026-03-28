import type { Candidate } from "./candidate.js";
import type { CacheStore } from "../cache/cache-store.js";

export interface StageContext {
  signal?: AbortSignal;
  cacheStore?: CacheStore;
}

export interface Stage {
  readonly name: string;
  process(candidates: Candidate[], context: StageContext): Promise<Candidate[]>;
}

export interface CacheableStage extends Stage {
  computeCacheKey(candidate: Candidate): string;
}

export function isCacheableStage(stage: Stage): stage is CacheableStage {
  return "computeCacheKey" in stage && typeof (stage as CacheableStage).computeCacheKey === "function";
}

export type StageFactory = (config: Record<string, unknown>) => Stage;

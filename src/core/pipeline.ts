import type { Candidate } from "./candidate.js";
import type { Stage, StageContext } from "./stage.js";
import { isCacheableStage } from "./stage.js";
import type { Language, Severity, FileContext } from "../types.js";

export interface PipelineConfig {
  ruleId: string;
  severity: Severity;
  description: string;
  language: Language;
  stages: Stage[];
}

export interface PipelineTrace {
  ruleId: string;
  totalDurationMs: number;
  stages: StageTraceEntry[];
}

export interface StageTraceEntry {
  name: string;
  candidatesIn: number;
  candidatesOut: number;
  durationMs: number;
  cacheHits?: number;
  cacheMisses?: number;
}

export interface PipelineResult {
  candidates: Candidate[];
  trace: PipelineTrace;
}

export async function executePipeline(
  config: PipelineConfig,
  files: FileContext[],
  context?: StageContext,
): Promise<PipelineResult> {
  const ctx: StageContext = context ?? {};
  const stageTraces: StageTraceEntry[] = [];
  const pipelineStart = performance.now();

  // Seed candidates: one per file (the first stage will expand them into real matches)
  let candidates: Candidate[] = files.map((file) => ({
    id: "",
    ruleId: config.ruleId,
    location: {
      filePath: file.filePath,
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 0,
    },
    matchedCode: "",
    metaVariables: {},
    annotations: {},
    filtered: false,
    fileContext: file,
  }));

  for (const stage of config.stages) {
    const activeCount = candidates.filter((c) => !c.filtered).length;
    if (activeCount === 0) break;

    const stageStart = performance.now();
    let cacheHits = 0;
    let cacheMisses = 0;

    const cacheable = ctx.cacheStore && isCacheableStage(stage);

    if (cacheable) {
      // Process candidates individually: check cache per candidate
      const cacheableStage = stage;
      const processed: Candidate[] = [];
      const uncached: Candidate[] = [];

      for (const candidate of candidates) {
        if (candidate.filtered) {
          processed.push(candidate);
          continue;
        }

        const cacheKey = cacheableStage.computeCacheKey(candidate);
        const cached = await ctx.cacheStore!.get(cacheKey);

        if (cached) {
          cacheHits++;
          processed.push({
            ...candidate,
            annotations: { ...candidate.annotations, ...cached.annotations },
            filtered: cached.filtered,
          });
        } else {
          uncached.push(candidate);
        }
      }

      // Process uncached candidates through the stage
      if (uncached.length > 0) {
        cacheMisses += uncached.length;
        const results = await stage.process(uncached, ctx);

        for (const result of results) {
          // Cache the result
          const cacheKey = cacheableStage.computeCacheKey(result);
          await ctx.cacheStore!.set(cacheKey, {
            annotations: result.annotations,
            filtered: result.filtered,
            cachedAt: Date.now(),
          });
          processed.push(result);
        }
      }

      candidates = processed;
    } else {
      candidates = await stage.process(candidates, ctx);
    }

    const stageEnd = performance.now();

    const activeAfter = candidates.filter((c) => !c.filtered).length;
    const traceEntry: StageTraceEntry = {
      name: stage.name,
      candidatesIn: activeCount,
      candidatesOut: activeAfter,
      durationMs: stageEnd - stageStart,
    };

    if (cacheable) {
      traceEntry.cacheHits = cacheHits;
      traceEntry.cacheMisses = cacheMisses;
    }

    stageTraces.push(traceEntry);
  }

  const pipelineEnd = performance.now();

  return {
    candidates,
    trace: {
      ruleId: config.ruleId,
      totalDurationMs: pipelineEnd - pipelineStart,
      stages: stageTraces,
    },
  };
}

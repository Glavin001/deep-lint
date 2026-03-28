import type { Candidate } from "./candidate.js";
import type { Stage, StageContext } from "./stage.js";
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
    candidates = await stage.process(candidates, ctx);
    const stageEnd = performance.now();

    const activeAfter = candidates.filter((c) => !c.filtered).length;
    stageTraces.push({
      name: stage.name,
      candidatesIn: activeCount,
      candidatesOut: activeAfter,
      durationMs: stageEnd - stageStart,
    });
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

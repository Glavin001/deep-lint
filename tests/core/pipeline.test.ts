import { describe, it, expect } from "vitest";
import { executePipeline, type PipelineConfig } from "../../src/core/pipeline.js";
import type { Stage } from "../../src/core/stage.js";
import type { Candidate } from "../../src/core/candidate.js";
import type { FileContext } from "../../src/types.js";

const testFile: FileContext = {
  filePath: "test.ts",
  content: 'console.log("hello");\nconsole.log("world");',
  language: "typescript",
};

function makeProducerStage(candidatesToProduce: number): Stage {
  return {
    name: "test-producer",
    async process(candidates) {
      const results: Candidate[] = [];
      for (const seed of candidates) {
        for (let i = 0; i < candidatesToProduce; i++) {
          results.push({
            ...seed,
            id: `${seed.fileContext.filePath}-${i}`,
            matchedCode: `match-${i}`,
            location: {
              ...seed.location,
              startLine: i + 1,
              endLine: i + 1,
            },
          });
        }
      }
      return results;
    },
  };
}

function makeFilterStage(predicate: (c: Candidate) => boolean): Stage {
  return {
    name: "test-filter",
    async process(candidates) {
      return candidates.map((c) => {
        if (c.filtered) return c;
        return { ...c, filtered: !predicate(c) };
      });
    },
  };
}

function makeAnnotatorStage(key: string, value: unknown): Stage {
  return {
    name: "test-annotator",
    async process(candidates) {
      return candidates.map((c) => {
        if (c.filtered) return c;
        return {
          ...c,
          annotations: { ...c.annotations, [key]: value },
        };
      });
    },
  };
}

function makeConfig(stages: Stage[]): PipelineConfig {
  return {
    ruleId: "test-rule",
    severity: "warning",
    description: "test rule",
    language: "typescript",
    stages,
  };
}

describe("executePipeline", () => {
  it("runs a single producer stage", async () => {
    const config = makeConfig([makeProducerStage(3)]);
    const result = await executePipeline(config, [testFile]);

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((c) => !c.filtered)).toBe(true);
    expect(result.trace.ruleId).toBe("test-rule");
    expect(result.trace.stages).toHaveLength(1);
    expect(result.trace.stages[0].name).toBe("test-producer");
    expect(result.trace.stages[0].candidatesIn).toBe(1);
    expect(result.trace.stages[0].candidatesOut).toBe(3);
  });

  it("runs producer then filter", async () => {
    const config = makeConfig([
      makeProducerStage(5),
      makeFilterStage((c) => c.matchedCode === "match-0" || c.matchedCode === "match-2"),
    ]);
    const result = await executePipeline(config, [testFile]);

    const active = result.candidates.filter((c) => !c.filtered);
    expect(active).toHaveLength(2);
    expect(result.candidates).toHaveLength(5); // all preserved
    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[1].candidatesIn).toBe(5);
    expect(result.trace.stages[1].candidatesOut).toBe(2);
  });

  it("runs producer, annotator, filter chain", async () => {
    const config = makeConfig([
      makeProducerStage(3),
      makeAnnotatorStage("score", 42),
      makeFilterStage((c) => c.matchedCode === "match-1"),
    ]);
    const result = await executePipeline(config, [testFile]);

    const active = result.candidates.filter((c) => !c.filtered);
    expect(active).toHaveLength(1);
    expect(active[0].annotations.score).toBe(42);
    expect(result.trace.stages).toHaveLength(3);
  });

  it("short-circuits when all candidates are filtered", async () => {
    let thirdStageRan = false;
    const thirdStage: Stage = {
      name: "should-not-run",
      async process(candidates) {
        thirdStageRan = true;
        return candidates;
      },
    };

    const config = makeConfig([
      makeProducerStage(2),
      makeFilterStage(() => false), // filter all
      thirdStage,
    ]);
    const result = await executePipeline(config, [testFile]);

    expect(thirdStageRan).toBe(false);
    expect(result.trace.stages).toHaveLength(2); // only 2 stages recorded
  });

  it("handles empty file list", async () => {
    const config = makeConfig([makeProducerStage(3)]);
    const result = await executePipeline(config, []);

    expect(result.candidates).toHaveLength(0);
    expect(result.trace.stages).toHaveLength(0);
  });

  it("handles multiple files", async () => {
    const file2: FileContext = {
      filePath: "test2.ts",
      content: "const x = 1;",
      language: "typescript",
    };
    const config = makeConfig([makeProducerStage(2)]);
    const result = await executePipeline(config, [testFile, file2]);

    expect(result.candidates).toHaveLength(4); // 2 per file
  });

  it("records timing in trace", async () => {
    const config = makeConfig([makeProducerStage(1)]);
    const result = await executePipeline(config, [testFile]);

    expect(result.trace.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.trace.stages[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

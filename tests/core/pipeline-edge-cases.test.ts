import { describe, it, expect } from "vitest";
import { executePipeline, type PipelineConfig } from "../../src/core/pipeline.js";
import type { Stage, StageContext } from "../../src/core/stage.js";
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
        if (seed.filtered) {
          results.push(seed);
          continue;
        }
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

describe("executePipeline edge cases", () => {
  it("propagates error when a stage throws mid-pipeline", async () => {
    const errorStage: Stage = {
      name: "error-stage",
      async process(): Promise<Candidate[]> {
        throw new Error("Stage exploded");
      },
    };

    const config = makeConfig([makeProducerStage(3), errorStage]);

    await expect(executePipeline(config, [testFile])).rejects.toThrow(
      "Stage exploded",
    );
  });

  it("propagates error from the first stage", async () => {
    const errorStage: Stage = {
      name: "first-error-stage",
      async process(): Promise<Candidate[]> {
        throw new TypeError("bad type");
      },
    };

    const config = makeConfig([errorStage, makeProducerStage(1)]);

    await expect(executePipeline(config, [testFile])).rejects.toThrow(
      "bad type",
    );
  });

  it("supports AbortSignal cancellation passed through StageContext", async () => {
    const controller = new AbortController();

    // A stage that checks the signal and throws if aborted
    const abortAwareStage: Stage = {
      name: "abort-aware",
      async process(candidates, context: StageContext) {
        if (context.signal?.aborted) {
          throw new Error("Aborted");
        }
        return candidates;
      },
    };

    // Abort before pipeline runs
    controller.abort();

    const config = makeConfig([makeProducerStage(2), abortAwareStage]);

    await expect(
      executePipeline(config, [testFile], { signal: controller.signal }),
    ).rejects.toThrow("Aborted");
  });

  it("passes AbortSignal through context to all stages", async () => {
    const controller = new AbortController();
    const receivedSignals: (AbortSignal | undefined)[] = [];

    const signalCapture: Stage = {
      name: "signal-capture",
      async process(candidates, context: StageContext) {
        receivedSignals.push(context.signal);
        return candidates;
      },
    };

    const config = makeConfig([signalCapture, signalCapture]);
    await executePipeline(config, [testFile], { signal: controller.signal });

    expect(receivedSignals).toHaveLength(2);
    expect(receivedSignals[0]).toBe(controller.signal);
    expect(receivedSignals[1]).toBe(controller.signal);
  });

  it("handles a large candidate count (100+)", async () => {
    const config = makeConfig([
      makeProducerStage(150),
      makeAnnotatorStage("checked", true),
    ]);
    const result = await executePipeline(config, [testFile]);

    expect(result.candidates).toHaveLength(150);
    expect(result.candidates.every((c) => !c.filtered)).toBe(true);
    expect(
      result.candidates.every((c) => c.annotations.checked === true),
    ).toBe(true);
    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[0].candidatesOut).toBe(150);
    expect(result.trace.stages[1].candidatesIn).toBe(150);
    expect(result.trace.stages[1].candidatesOut).toBe(150);
  });

  it("runs a pipeline with 3+ stages in sequence", async () => {
    const config = makeConfig([
      makeProducerStage(5),
      makeAnnotatorStage("step1", "done"),
      makeFilterStage((c) => c.matchedCode === "match-0" || c.matchedCode === "match-3"),
      makeAnnotatorStage("step3", "done"),
    ]);
    const result = await executePipeline(config, [testFile]);

    expect(result.trace.stages).toHaveLength(4);
    const active = result.candidates.filter((c) => !c.filtered);
    expect(active).toHaveLength(2);
    // Only non-filtered candidates get annotated by step3
    expect(active.every((c) => c.annotations.step3 === "done")).toBe(true);
    // All candidates should have step1 annotation (applied before filter)
    const nonFiltered = result.candidates.filter((c) => !c.filtered);
    expect(nonFiltered.every((c) => c.annotations.step1 === "done")).toBe(true);
  });

  it("short-circuits: second and third stages skipped when all candidates filtered after first stage", async () => {
    let secondStageRan = false;
    let thirdStageRan = false;

    const secondStage: Stage = {
      name: "second-stage",
      async process(candidates) {
        secondStageRan = true;
        return candidates;
      },
    };

    const thirdStage: Stage = {
      name: "third-stage",
      async process(candidates) {
        thirdStageRan = true;
        return candidates;
      },
    };

    const config = makeConfig([
      makeProducerStage(3),
      makeFilterStage(() => false), // filter all
      secondStage,
      thirdStage,
    ]);
    const result = await executePipeline(config, [testFile]);

    expect(secondStageRan).toBe(false);
    expect(thirdStageRan).toBe(false);
    // Only producer and filter stages recorded in trace
    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[0].name).toBe("test-producer");
    expect(result.trace.stages[1].name).toBe("test-filter");
    expect(result.trace.stages[1].candidatesOut).toBe(0);
    // All candidates are still present but filtered
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((c) => c.filtered)).toBe(true);
  });

  it("short-circuits correctly with initial empty file list (no stages run)", async () => {
    let stageRan = false;
    const stage: Stage = {
      name: "should-not-run",
      async process(candidates) {
        stageRan = true;
        return candidates;
      },
    };

    const config = makeConfig([stage]);
    const result = await executePipeline(config, []);

    expect(stageRan).toBe(false);
    expect(result.candidates).toHaveLength(0);
    expect(result.trace.stages).toHaveLength(0);
  });

  it("trace candidatesOut counts only non-filtered candidates", async () => {
    const config = makeConfig([
      makeProducerStage(10),
      makeFilterStage((c) => c.matchedCode === "match-0"),
    ]);
    const result = await executePipeline(config, [testFile]);

    expect(result.trace.stages[1].candidatesIn).toBe(10);
    expect(result.trace.stages[1].candidatesOut).toBe(1);
    // Total candidates array still has all 10
    expect(result.candidates).toHaveLength(10);
  });
});

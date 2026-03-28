import { describe, it, expect } from "vitest";
import { createLlmStage, interpolatePrompt } from "../../src/stages/llm.js";
import { createCandidate, type Candidate } from "../../src/core/candidate.js";
import type { FileContext } from "../../src/types.js";
import { createMockModel, createMockModelWithInvalidResponse } from "../fixtures/helpers/mock-llm.js";

const fileContext: FileContext = {
  filePath: "test.ts",
  content: 'console.log("hello");',
  language: "typescript",
};

function makeCandidate(overrides?: Partial<Candidate>): Candidate {
  return {
    ...createCandidate({
      ruleId: "test-rule",
      location: {
        filePath: "test.ts",
        startLine: 1,
        startColumn: 0,
        endLine: 1,
        endColumn: 21,
      },
      matchedCode: 'console.log("hello")',
      metaVariables: { ARGS: '"hello"' },
      fileContext,
    }),
    ...overrides,
  };
}

describe("interpolatePrompt", () => {
  it("replaces $MATCHED_CODE", () => {
    const candidate = makeCandidate();
    const result = interpolatePrompt("Code: $MATCHED_CODE", candidate);
    expect(result).toBe('Code: console.log("hello")');
  });

  it("replaces $FILE_PATH", () => {
    const candidate = makeCandidate();
    const result = interpolatePrompt("File: $FILE_PATH", candidate);
    expect(result).toBe("File: test.ts");
  });

  it("replaces metavariables", () => {
    const candidate = makeCandidate();
    const result = interpolatePrompt("Args: $ARGS", candidate);
    expect(result).toBe('Args: "hello"');
  });

  it("replaces multiple occurrences", () => {
    const candidate = makeCandidate();
    const result = interpolatePrompt("$ARGS and $ARGS", candidate);
    expect(result).toBe('"hello" and "hello"');
  });

  it("leaves unknown variables untouched", () => {
    const candidate = makeCandidate();
    const result = interpolatePrompt("$UNKNOWN stays", candidate);
    expect(result).toBe("$UNKNOWN stays");
  });
});

describe("createLlmStage", () => {
  it("marks violations with high confidence as not filtered", async () => {
    const model = createMockModel({
      isViolation: true,
      confidence: 0.9,
      reasoning: "This is a violation",
    });
    const stage = createLlmStage({
      prompt: "Check: $MATCHED_CODE",
      model,
      confidenceThreshold: 0.7,
    });
    const results = await stage.process([makeCandidate()], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(false);
    expect(results[0].annotations.llmVerdict).toBe(true);
    expect(results[0].annotations.llmConfidence).toBe(0.9);
    expect(results[0].annotations.llmReasoning).toBe("This is a violation");
  });

  it("filters non-violations", async () => {
    const model = createMockModel({
      isViolation: false,
      confidence: 0.95,
      reasoning: "This is clean code",
    });
    const stage = createLlmStage({
      prompt: "Check: $MATCHED_CODE",
      model,
    });
    const results = await stage.process([makeCandidate()], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].annotations.llmVerdict).toBe(false);
  });

  it("filters violations below confidence threshold", async () => {
    const model = createMockModel({
      isViolation: true,
      confidence: 0.3,
      reasoning: "Maybe a violation",
    });
    const stage = createLlmStage({
      prompt: "Check: $MATCHED_CODE",
      model,
      confidenceThreshold: 0.7,
    });
    const results = await stage.process([makeCandidate()], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].annotations.llmConfidence).toBe(0.3);
  });

  it("passes through already-filtered candidates", async () => {
    const model = createMockModel({
      isViolation: true,
      confidence: 0.9,
      reasoning: "test",
    });
    const stage = createLlmStage({
      prompt: "Check: $MATCHED_CODE",
      model,
    });
    const filtered = makeCandidate({ filtered: true });
    const results = await stage.process([filtered], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].annotations.llmVerdict).toBeUndefined();
  });

  it("handles malformed LLM response gracefully", async () => {
    const model = createMockModelWithInvalidResponse();
    const stage = createLlmStage({
      prompt: "Check: $MATCHED_CODE",
      model,
    });
    const results = await stage.process([makeCandidate()], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(false); // not filtered on error
    expect(results[0].annotations.llmError).toBeDefined();
  });

  it("processes multiple candidates", async () => {
    const model = createMockModel({
      isViolation: true,
      confidence: 0.85,
      reasoning: "violation",
    });
    const stage = createLlmStage({
      prompt: "Check: $MATCHED_CODE",
      model,
      confidenceThreshold: 0.5,
    });
    const candidates = [makeCandidate(), makeCandidate(), makeCandidate()];
    const results = await stage.process(candidates, {});

    expect(results).toHaveLength(3);
    expect(results.every((r) => !r.filtered)).toBe(true);
    expect(results.every((r) => r.annotations.llmConfidence === 0.85)).toBe(true);
  });

  it("uses default confidence threshold of 0.5", async () => {
    const model = createMockModel({
      isViolation: true,
      confidence: 0.6,
      reasoning: "moderate confidence",
    });
    const stage = createLlmStage({
      prompt: "Check: $MATCHED_CODE",
      model,
      // no threshold specified, should default to 0.5
    });
    const results = await stage.process([makeCandidate()], {});

    expect(results[0].filtered).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { createLlmStage, interpolatePrompt, extractSurroundingLines, computeLlmCacheKey } from "../../src/stages/llm.js";
import { isCacheableStage } from "../../src/core/stage.js";
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

describe("extractSurroundingLines", () => {
  const content = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8";

  it("extracts N lines before and after", () => {
    expect(extractSurroundingLines(content, 4, 4, 2)).toBe("line2\nline3\nline4\nline5\nline6");
  });

  it("clamps to file start", () => {
    expect(extractSurroundingLines(content, 1, 1, 5)).toBe("line1\nline2\nline3\nline4\nline5\nline6");
  });

  it("clamps to file end", () => {
    expect(extractSurroundingLines(content, 8, 8, 5)).toBe("line3\nline4\nline5\nline6\nline7\nline8");
  });

  it("handles multi-line match", () => {
    expect(extractSurroundingLines(content, 3, 5, 1)).toBe("line2\nline3\nline4\nline5\nline6");
  });

  it("handles 0 surrounding lines", () => {
    expect(extractSurroundingLines(content, 4, 4, 0)).toBe("line4");
  });
});

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

  it("replaces $FILE_CONTENT with full file content", () => {
    const candidate = makeCandidate();
    const result = interpolatePrompt("Full: $FILE_CONTENT", candidate);
    expect(result).toBe('Full: console.log("hello");');
  });

  it("replaces $START_LINE and $END_LINE", () => {
    const candidate = makeCandidate();
    const result = interpolatePrompt("Lines $START_LINE to $END_LINE", candidate);
    expect(result).toBe("Lines 1 to 1");
  });

  it("replaces $LANGUAGE", () => {
    const candidate = makeCandidate();
    const result = interpolatePrompt("Lang: $LANGUAGE", candidate);
    expect(result).toBe("Lang: typescript");
  });

  it("replaces $SURROUNDING(N) with surrounding lines", () => {
    const multiLineContent = "line1\nline2\nline3\nline4\nline5\nline6\nline7";
    const candidate = makeCandidate({
      fileContext: { filePath: "test.ts", content: multiLineContent, language: "typescript" },
      location: { filePath: "test.ts", startLine: 4, startColumn: 0, endLine: 4, endColumn: 5 },
    });
    const result = interpolatePrompt("Context:\n$SURROUNDING(2)", candidate);
    // Lines 2-6 (2 before line 4, line 4, 2 after line 4)
    expect(result).toBe("Context:\nline2\nline3\nline4\nline5\nline6");
  });

  it("handles $SURROUNDING(N) near file start", () => {
    const content = "line1\nline2\nline3";
    const candidate = makeCandidate({
      fileContext: { filePath: "test.ts", content, language: "typescript" },
      location: { filePath: "test.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 5 },
    });
    const result = interpolatePrompt("$SURROUNDING(5)", candidate);
    expect(result).toBe("line1\nline2\nline3");
  });

  it("handles $SURROUNDING(N) near file end", () => {
    const content = "line1\nline2\nline3";
    const candidate = makeCandidate({
      fileContext: { filePath: "test.ts", content, language: "typescript" },
      location: { filePath: "test.ts", startLine: 3, startColumn: 0, endLine: 3, endColumn: 5 },
    });
    const result = interpolatePrompt("$SURROUNDING(5)", candidate);
    expect(result).toBe("line1\nline2\nline3");
  });

  it("mixes multiple variables in one prompt", () => {
    const candidate = makeCandidate();
    const result = interpolatePrompt(
      "File: $FILE_PATH ($LANGUAGE) line $START_LINE\nCode: $MATCHED_CODE\nArgs: $ARGS",
      candidate,
    );
    expect(result).toBe(
      'File: test.ts (typescript) line 1\nCode: console.log("hello")\nArgs: "hello"',
    );
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

describe("LLM stage caching", () => {
  it("is cacheable when modelId is provided", () => {
    const model = createMockModel({ isViolation: true, confidence: 0.9, reasoning: "test" });
    const stage = createLlmStage({ prompt: "Check: $MATCHED_CODE", model, modelId: "gpt-4" });
    expect(isCacheableStage(stage)).toBe(true);
  });

  it("is not cacheable when modelId is omitted", () => {
    const model = createMockModel({ isViolation: true, confidence: 0.9, reasoning: "test" });
    const stage = createLlmStage({ prompt: "Check: $MATCHED_CODE", model });
    expect(isCacheableStage(stage)).toBe(false);
  });

  it("produces deterministic cache keys", () => {
    const model = createMockModel({ isViolation: true, confidence: 0.9, reasoning: "test" });
    const stage = createLlmStage({ prompt: "Check: $MATCHED_CODE", model, modelId: "gpt-4" });
    if (!isCacheableStage(stage)) throw new Error("expected cacheable");

    const candidate = makeCandidate();
    const key1 = stage.computeCacheKey(candidate);
    const key2 = stage.computeCacheKey(candidate);
    expect(key1).toBe(key2);
  });

  it("produces different keys for different prompts", () => {
    const key1 = computeLlmCacheKey("gpt-4", 42, 0.5, "prompt A");
    const key2 = computeLlmCacheKey("gpt-4", 42, 0.5, "prompt B");
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different models", () => {
    const key1 = computeLlmCacheKey("gpt-4", 42, 0.5, "same prompt");
    const key2 = computeLlmCacheKey("claude-3", 42, 0.5, "same prompt");
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different seeds (cache busting)", () => {
    const key1 = computeLlmCacheKey("gpt-4", 42, 0.5, "same prompt");
    const key2 = computeLlmCacheKey("gpt-4", 99, 0.5, "same prompt");
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different thresholds", () => {
    const key1 = computeLlmCacheKey("gpt-4", 42, 0.5, "same prompt");
    const key2 = computeLlmCacheKey("gpt-4", 42, 0.7, "same prompt");
    expect(key1).not.toBe(key2);
  });
});

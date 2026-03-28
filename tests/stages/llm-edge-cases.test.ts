import { describe, it, expect } from "vitest";
import { createLlmStage, interpolatePrompt, extractSurroundingLines, computeLlmCacheKey } from "../../src/stages/llm.js";
import { createCandidate, type Candidate } from "../../src/core/candidate.js";
import { isCacheableStage, type CacheableStage } from "../../src/core/stage.js";
import type { FileContext } from "../../src/types.js";
import {
  createMockModel,
  createMockModelFromFn,
} from "../fixtures/helpers/mock-llm.js";

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

describe("LLM stage edge cases", () => {
  describe("confidence threshold boundary", () => {
    it("does NOT filter when confidence equals threshold exactly (0.7 == 0.7)", async () => {
      const model = createMockModel({
        isViolation: true,
        confidence: 0.7,
        reasoning: "Exactly at threshold",
      });
      const stage = createLlmStage({
        prompt: "Check: $MATCHED_CODE",
        model,
        confidenceThreshold: 0.7,
      });
      const results = await stage.process([makeCandidate()], {});

      expect(results).toHaveLength(1);
      // confidence (0.7) is NOT less than threshold (0.7), and isViolation is true
      // so it should NOT be filtered
      expect(results[0].filtered).toBe(false);
      expect(results[0].annotations.llmConfidence).toBe(0.7);
    });

    it("filters when confidence is just below threshold (0.69 < 0.7)", async () => {
      const model = createMockModel({
        isViolation: true,
        confidence: 0.69,
        reasoning: "Just below threshold",
      });
      const stage = createLlmStage({
        prompt: "Check: $MATCHED_CODE",
        model,
        confidenceThreshold: 0.7,
      });
      const results = await stage.process([makeCandidate()], {});

      expect(results).toHaveLength(1);
      // confidence (0.69) < threshold (0.7), so it should be filtered
      expect(results[0].filtered).toBe(true);
      expect(results[0].annotations.llmConfidence).toBe(0.69);
    });

    it("does NOT filter when confidence is just above threshold (0.71 > 0.7)", async () => {
      const model = createMockModel({
        isViolation: true,
        confidence: 0.71,
        reasoning: "Just above threshold",
      });
      const stage = createLlmStage({
        prompt: "Check: $MATCHED_CODE",
        model,
        confidenceThreshold: 0.7,
      });
      const results = await stage.process([makeCandidate()], {});

      expect(results).toHaveLength(1);
      expect(results[0].filtered).toBe(false);
      expect(results[0].annotations.llmConfidence).toBe(0.71);
    });
  });

  describe("multiple LLM stages in sequence (double-check pattern)", () => {
    it("runs two LLM stages: first passes, second confirms", async () => {
      const firstModel = createMockModel({
        isViolation: true,
        confidence: 0.8,
        reasoning: "First pass: likely violation",
      });
      const secondModel = createMockModel({
        isViolation: true,
        confidence: 0.95,
        reasoning: "Second pass: confirmed violation",
      });

      const firstStage = createLlmStage({
        prompt: "Initial check: $MATCHED_CODE",
        model: firstModel,
        confidenceThreshold: 0.5,
      });
      const secondStage = createLlmStage({
        prompt: "Double check: $MATCHED_CODE",
        model: secondModel,
        confidenceThreshold: 0.7,
      });

      let results = await firstStage.process([makeCandidate()], {});
      expect(results[0].filtered).toBe(false);
      expect(results[0].annotations.llmConfidence).toBe(0.8);

      results = await secondStage.process(results, {});
      expect(results[0].filtered).toBe(false);
      // Second stage overwrites annotations
      expect(results[0].annotations.llmConfidence).toBe(0.95);
      expect(results[0].annotations.llmReasoning).toBe(
        "Second pass: confirmed violation",
      );
    });

    it("second LLM stage filters out a candidate that first stage passed", async () => {
      const firstModel = createMockModel({
        isViolation: true,
        confidence: 0.8,
        reasoning: "Looks bad",
      });
      const secondModel = createMockModel({
        isViolation: false,
        confidence: 0.9,
        reasoning: "Actually fine",
      });

      const firstStage = createLlmStage({
        prompt: "Check: $MATCHED_CODE",
        model: firstModel,
        confidenceThreshold: 0.5,
      });
      const secondStage = createLlmStage({
        prompt: "Recheck: $MATCHED_CODE",
        model: secondModel,
        confidenceThreshold: 0.5,
      });

      let results = await firstStage.process([makeCandidate()], {});
      expect(results[0].filtered).toBe(false);

      results = await secondStage.process(results, {});
      // Second LLM says isViolation=false so it should be filtered
      expect(results[0].filtered).toBe(true);
      expect(results[0].annotations.llmVerdict).toBe(false);
    });

    it("second LLM stage skips already-filtered candidates from first stage", async () => {
      const firstModel = createMockModel({
        isViolation: false,
        confidence: 0.9,
        reasoning: "Not a violation",
      });

      let secondModelCalled = false;
      const secondModel = createMockModelFromFn(() => {
        secondModelCalled = true;
        return {
          isViolation: true,
          confidence: 1.0,
          reasoning: "Should not be called",
        };
      });

      const firstStage = createLlmStage({
        prompt: "Check: $MATCHED_CODE",
        model: firstModel,
        confidenceThreshold: 0.5,
      });
      const secondStage = createLlmStage({
        prompt: "Recheck: $MATCHED_CODE",
        model: secondModel,
        confidenceThreshold: 0.5,
      });

      let results = await firstStage.process([makeCandidate()], {});
      expect(results[0].filtered).toBe(true);

      results = await secondStage.process(results, {});
      // Second model should not have been called for the filtered candidate
      expect(secondModelCalled).toBe(false);
      expect(results[0].filtered).toBe(true);
    });
  });

  describe("very long matched code in prompt", () => {
    it("handles matched code exceeding 1000 characters", async () => {
      const longCode = "x".repeat(1500);
      const longCandidate = makeCandidate({ matchedCode: longCode });

      let receivedPrompt = "";
      const model = createMockModelFromFn((prompt) => {
        receivedPrompt = prompt;
        return {
          isViolation: true,
          confidence: 0.85,
          reasoning: "Long code violation",
        };
      });

      const stage = createLlmStage({
        prompt: "Analyze this code: $MATCHED_CODE",
        model,
        confidenceThreshold: 0.5,
      });

      const results = await stage.process([longCandidate], {});

      expect(results).toHaveLength(1);
      expect(results[0].filtered).toBe(false);
      // The prompt should contain the full long code
      expect(receivedPrompt).toContain(longCode);
    });
  });

  describe("prompt interpolation with all variable types", () => {
    it("interpolates $MATCHED_CODE, $FILE_PATH, and metavariables together", () => {
      const candidate = makeCandidate({
        matchedCode: "foo(bar)",
        metaVariables: { FUNC: "foo", ARG: "bar" },
        fileContext: {
          filePath: "src/utils/helper.ts",
          content: "foo(bar);",
          language: "typescript",
        },
      });

      const template =
        "File: $FILE_PATH\nCode: $MATCHED_CODE\nFunction: $FUNC\nArgument: $ARG";
      const result = interpolatePrompt(template, candidate);

      expect(result).toBe(
        "File: src/utils/helper.ts\nCode: foo(bar)\nFunction: foo\nArgument: bar",
      );
    });

    it("interpolates multiple occurrences of the same variable", () => {
      const candidate = makeCandidate({
        matchedCode: "test()",
        metaVariables: { NAME: "test" },
      });

      const template = "$NAME is called as $MATCHED_CODE and $NAME again";
      const result = interpolatePrompt(template, candidate);

      expect(result).toBe("test is called as test() and test again");
    });

    it("leaves unknown metavariable placeholders untouched", () => {
      const candidate = makeCandidate({
        matchedCode: "x",
        metaVariables: {},
      });

      const template = "Code: $MATCHED_CODE, Unknown: $NOPE";
      const result = interpolatePrompt(template, candidate);

      expect(result).toBe("Code: x, Unknown: $NOPE");
    });

    it("handles metavariables with values containing special regex characters", () => {
      const candidate = makeCandidate({
        matchedCode: "x",
        metaVariables: { PATTERN: "a.*b+c?" },
      });

      const template = "Pattern is $PATTERN end";
      const result = interpolatePrompt(template, candidate);

      expect(result).toBe("Pattern is a.*b+c? end");
    });

    it("interpolates all variables in a realistic prompt with long code", async () => {
      const longCode = 'if (user.role === "admin") {\n' + "  ".repeat(50) + "deleteAll();\n}";
      const candidate = makeCandidate({
        matchedCode: longCode,
        metaVariables: { ROLE: '"admin"', FUNC: "deleteAll" },
        fileContext: {
          filePath: "src/controllers/admin.ts",
          content: longCode,
          language: "typescript",
        },
      });

      let capturedPrompt = "";
      const model = createMockModelFromFn((prompt) => {
        capturedPrompt = prompt;
        return {
          isViolation: true,
          confidence: 0.92,
          reasoning: "Dangerous pattern",
        };
      });

      const stage = createLlmStage({
        prompt:
          "In file $FILE_PATH, check if this code is safe:\n$MATCHED_CODE\nRole checked: $ROLE\nFunction called: $FUNC",
        model,
        confidenceThreshold: 0.5,
      });

      const results = await stage.process([candidate], {});

      expect(results[0].filtered).toBe(false);
      expect(capturedPrompt).toContain("src/controllers/admin.ts");
      expect(capturedPrompt).toContain(longCode);
      expect(capturedPrompt).toContain('"admin"');
      expect(capturedPrompt).toContain("deleteAll");
    });
  });

  describe("$SURROUNDING(N) edge cases", () => {
    it("handles single-line file", () => {
      const candidate = makeCandidate({
        fileContext: { filePath: "t.ts", content: "const x = 1;", language: "typescript" },
        location: { filePath: "t.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 12 },
      });
      expect(interpolatePrompt("$SURROUNDING(10)", candidate)).toBe("const x = 1;");
    });

    it("handles $SURROUNDING(0) returning only matched lines", () => {
      const content = "line1\nline2\nline3\nline4\nline5";
      const candidate = makeCandidate({
        fileContext: { filePath: "t.ts", content, language: "typescript" },
        location: { filePath: "t.ts", startLine: 3, startColumn: 0, endLine: 3, endColumn: 5 },
      });
      expect(interpolatePrompt("$SURROUNDING(0)", candidate)).toBe("line3");
    });

    it("handles multi-line match spanning 3 lines with surrounding", () => {
      const content = "a\nb\nc\nd\ne\nf\ng\nh";
      const candidate = makeCandidate({
        fileContext: { filePath: "t.ts", content, language: "typescript" },
        location: { filePath: "t.ts", startLine: 3, startColumn: 0, endLine: 5, endColumn: 1 },
      });
      // 1 line before line 3, lines 3-5, 1 line after line 5
      expect(interpolatePrompt("$SURROUNDING(1)", candidate)).toBe("b\nc\nd\ne\nf");
    });

    it("handles very large N on small file", () => {
      const content = "one\ntwo\nthree";
      const candidate = makeCandidate({
        fileContext: { filePath: "t.ts", content, language: "typescript" },
        location: { filePath: "t.ts", startLine: 2, startColumn: 0, endLine: 2, endColumn: 3 },
      });
      expect(interpolatePrompt("$SURROUNDING(1000)", candidate)).toBe("one\ntwo\nthree");
    });

    it("handles empty file content", () => {
      const candidate = makeCandidate({
        fileContext: { filePath: "t.ts", content: "", language: "typescript" },
        location: { filePath: "t.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 },
      });
      expect(interpolatePrompt("$SURROUNDING(5)", candidate)).toBe("");
    });

    it("supports multiple $SURROUNDING(N) with different N in same prompt", () => {
      const content = "a\nb\nc\nd\ne\nf\ng";
      const candidate = makeCandidate({
        fileContext: { filePath: "t.ts", content, language: "typescript" },
        location: { filePath: "t.ts", startLine: 4, startColumn: 0, endLine: 4, endColumn: 1 },
      });
      const result = interpolatePrompt("narrow: $SURROUNDING(1)\nwide: $SURROUNDING(3)", candidate);
      expect(result).toBe("narrow: c\nd\ne\nwide: a\nb\nc\nd\ne\nf\ng");
    });
  });

  describe("new interpolation variables in realistic prompts", () => {
    it("$FILE_CONTENT in prompt with special characters in file", () => {
      const content = 'const regex = /\\d+/g;\nconst str = "hello $world";';
      const candidate = makeCandidate({
        fileContext: { filePath: "regex.ts", content, language: "typescript" },
        matchedCode: 'const regex = /\\d+/g;',
      });
      const result = interpolatePrompt("Full file:\n$FILE_CONTENT", candidate);
      expect(result).toContain(content);
    });

    it("$LANGUAGE reflects the file context language", () => {
      const candidate = makeCandidate({
        fileContext: { filePath: "app.tsx", content: "code", language: "tsx" },
      });
      expect(interpolatePrompt("$LANGUAGE", candidate)).toBe("tsx");
    });

    it("$START_LINE and $END_LINE for multi-line match", () => {
      const candidate = makeCandidate({
        location: { filePath: "t.ts", startLine: 10, startColumn: 0, endLine: 25, endColumn: 1 },
      });
      expect(interpolatePrompt("$START_LINE-$END_LINE", candidate)).toBe("10-25");
    });
  });

  describe("caching edge cases", () => {
    it("cache key is different when only whitespace in code differs", () => {
      const key1 = computeLlmCacheKey("m", 42, 0.5, "function foo() {}");
      const key2 = computeLlmCacheKey("m", 42, 0.5, "function foo()  {}");
      expect(key1).not.toBe(key2);
    });

    it("cache key is stable across repeated computations", () => {
      const keys = Array.from({ length: 5 }, () =>
        computeLlmCacheKey("gpt-4", 42, 0.7, "analyze this code"),
      );
      expect(new Set(keys).size).toBe(1);
    });

    it("cacheable LLM stage computes different keys for different candidates", () => {
      const model = createMockModel({ isViolation: true, confidence: 0.9, reasoning: "test" });
      const stage = createLlmStage({ prompt: "$MATCHED_CODE", model, modelId: "gpt-4" });
      if (!isCacheableStage(stage)) throw new Error("expected cacheable");

      const c1 = makeCandidate({ matchedCode: "code A" });
      const c2 = makeCandidate({ matchedCode: "code B" });
      expect(stage.computeCacheKey(c1)).not.toBe(stage.computeCacheKey(c2));
    });

    it("cacheable LLM stage computes same key for identical candidates", () => {
      const model = createMockModel({ isViolation: true, confidence: 0.9, reasoning: "test" });
      const stage = createLlmStage({ prompt: "$MATCHED_CODE", model, modelId: "gpt-4" });
      if (!isCacheableStage(stage)) throw new Error("expected cacheable");

      const c1 = makeCandidate({ matchedCode: "same code" });
      const c2 = makeCandidate({ matchedCode: "same code" });
      expect(stage.computeCacheKey(c1)).toBe(stage.computeCacheKey(c2));
    });

    it("default seed of 42 is used in cache key when seed is not specified", () => {
      const model = createMockModel({ isViolation: true, confidence: 0.9, reasoning: "test" });
      const stageNoSeed = createLlmStage({ prompt: "test", model, modelId: "m" });
      const stageExplicit42 = createLlmStage({ prompt: "test", model, modelId: "m", seed: 42 });
      if (!isCacheableStage(stageNoSeed) || !isCacheableStage(stageExplicit42)) {
        throw new Error("expected cacheable");
      }
      const c = makeCandidate();
      expect(stageNoSeed.computeCacheKey(c)).toBe(stageExplicit42.computeCacheKey(c));
    });
  });
});

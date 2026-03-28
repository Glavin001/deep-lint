import { describe, it, expect } from "vitest";
import { createLlmStage, interpolatePrompt } from "../../src/stages/llm.js";
import { createCandidate, type Candidate } from "../../src/core/candidate.js";
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
});

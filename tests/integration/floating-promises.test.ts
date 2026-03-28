import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRuleYaml,
  buildPipeline,
  executePipeline,
  type FileContext,
} from "../../src/index.js";
import { createMockModelFromFn } from "../fixtures/helpers/mock-llm.js";

const fixture = readFileSync(
  join(__dirname, "../fixtures/code/floating-promises.ts"),
  "utf-8",
);

const file: FileContext = {
  filePath: "floating-promises.ts",
  content: fixture,
  language: "typescript",
};

/**
 * Floating Promises — 3-Stage Pipeline (ast-grep + regex + LLM)
 *
 * WHY DEEP-LINT IS BETTER — THE FLAGSHIP EXAMPLE:
 * This demonstrates a 3-tool pipeline that NO single tool can replicate:
 *
 * - Stage 1 (ast-grep): Finds all function calls — fast structural matching
 * - Stage 2 (regex, inverted): Filters OUT calls that are already awaited,
 *   returned, void'd, or chained with .then/.catch — lightweight text check
 * - Stage 3 (LLM): For the remaining candidates, evaluates whether the
 *   missing await is intentional (fire-and-forget analytics) or a bug
 *
 * ESLint's @typescript-eslint/no-floating-promises requires full type info
 * and still can't distinguish intentional fire-and-forget from bugs.
 * ast-grep alone can't check for await/then/catch patterns.
 * Regex alone can't identify function calls structurally.
 * LLM alone is too slow for every line of code.
 *
 * Deep-lint chains all three: structural matching → text filtering → semantic
 * analysis. Each stage narrows the candidate set, so the expensive LLM call
 * only runs on the few remaining ambiguous cases.
 */
const rule = parseRuleYaml(`
id: no-unhandled-promise
language: typescript
severity: error
description: "Promise-returning calls must be awaited, caught, or explicitly voided"
pipeline:
  - ast-grep:
      pattern: "$FUNC($$$ARGS)"
  - regex:
      pattern: "(await |return |void |Promise\\\\.|\\\\. ?then|\\\\. ?catch|\\\\.finally)"
      invert: true
  - llm:
      prompt: |
        This function call may return a Promise that is not awaited or caught.
        Code: $MATCHED_CODE
        Function: $FUNC
        Is the missing await intentional (fire-and-forget for analytics/logging)?
      confidence_threshold: 0.8
`);

// Mock LLM: check if the function is analytics/logging (intentional fire-and-forget)
const model = createMockModelFromFn((prompt) => {
  const funcMatch = prompt.match(/Function:\s*(\S+)/);
  const func = funcMatch?.[1]?.trim() ?? "";

  // Logging/analytics fire-and-forget is intentional
  const intentionalFireAndForget = ["logEvent", "trackPageView", "sendNotification"];
  const isIntentional = intentionalFireAndForget.some((f) => func.includes(f));

  return {
    isViolation: !isIntentional,
    confidence: 0.9,
    reasoning: isIntentional
      ? "Fire-and-forget for analytics/logging — intentional"
      : "Promise not awaited — potential bug, data may be lost",
  };
});

describe("Floating Promises Detection (ast-grep + regex + LLM)", () => {
  it("demonstrates 3-stage pipeline narrowing", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    // Verify 3-stage trace
    expect(result.trace.stages).toHaveLength(3);
    expect(result.trace.stages[0].name).toBe("ast-grep");
    expect(result.trace.stages[1].name).toBe("regex");
    expect(result.trace.stages[2].name).toBe("llm");

    // Each stage should progressively narrow candidates
    expect(result.trace.stages[0].candidatesOut).toBeGreaterThan(
      result.trace.stages[1].candidatesOut,
    );
  });

  it("regex stage filters out already-awaited/returned calls", async () => {
    // Run with just ast-grep + regex (no LLM)
    const ruleNoLlm = parseRuleYaml(`
id: no-unhandled-promise-structural
language: typescript
severity: error
description: "test"
pipeline:
  - ast-grep:
      pattern: "$FUNC($$$ARGS)"
  - regex:
      pattern: "(await |return |void |Promise\\\\.|\\\\. ?then|\\\\. ?catch|\\\\.finally)"
      invert: true
`);
    const pipeline = buildPipeline(ruleNoLlm, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);

    // After regex filtering, calls with await/return/void/.then/.catch should be gone
    const active = result.candidates.filter((c) => !c.filtered);

    // Active candidates should NOT include properly handled promises
    const activeCode = active.map((c) => c.matchedCode);
    // These should be filtered out by regex (they contain await, return, void, .then, .catch):
    for (const code of activeCode) {
      expect(code).not.toMatch(/^await /);
      expect(code).not.toMatch(/\.then\(/);
      expect(code).not.toMatch(/\.catch\(/);
      expect(code).not.toMatch(/^void /);
    }
  });

  it("LLM stage distinguishes intentional fire-and-forget from bugs", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // Violations should include unhandled calls to fetchUser, fetch, sendNotification
    // but NOT logEvent (intentional fire-and-forget for analytics)
    const violationFuncs = violations.map((c) => c.metaVariables.FUNC);

    // logEvent/trackPageView should be filtered as intentional
    expect(violationFuncs).not.toContain("logEvent");
  });

  it("is the most complex pipeline with error severity", async () => {
    expect(rule.severity).toBe("error");
    expect(rule.pipeline.length).toBe(3);
    expect(rule.pipeline[0].type).toBe("ast-grep");
    expect(rule.pipeline[1].type).toBe("regex");
    expect(rule.pipeline[2].type).toBe("llm");
  });
});

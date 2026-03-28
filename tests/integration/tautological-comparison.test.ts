import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRuleYaml,
  buildPipeline,
  executePipeline,
  type FileContext,
} from "../../src/index.js";
import { createMockModelFromFn } from "../fixtures/helpers/mock-llm.js";

// Mock runTool since Semgrep may not be installed
vi.mock("../../src/stages/tool-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/stages/tool-runner.js")>();
  return {
    ...actual,
    runTool: vi.fn(),
  };
});

import { runTool } from "../../src/stages/tool-runner.js";
const mockedRunTool = vi.mocked(runTool);

const fixture = readFileSync(
  join(__dirname, "../fixtures/code/tautological-checks.ts"),
  "utf-8",
);

const file: FileContext = {
  filePath: "tautological-checks.ts",
  content: fixture,
  language: "typescript",
};

/**
 * Tautological Comparison Detection (Semgrep + LLM)
 *
 * WHY DEEP-LINT IS BETTER:
 * - Semgrep excels at finding `$X == $X` patterns across languages
 * - But Semgrep alone can't distinguish bugs from intentional NaN checks
 *   (JavaScript: `value !== value` is the idiomatic NaN check)
 * - ESLint has no built-in rule for this pattern
 * - Deep-lint: Semgrep stage finds all self-comparisons precisely using its
 *   powerful pattern matching, then LLM evaluates whether each is an
 *   intentional NaN check or a copy-paste bug. Best of both tools.
 */
const rule = parseRuleYaml(`
id: no-tautological-comparison
language: typescript
severity: warning
description: "Flag comparisons of a value with itself (likely copy-paste bug)"
pipeline:
  - semgrep:
      pattern: "$X == $X"
  - llm:
      prompt: |
        This comparison compares a value with itself: $MATCHED_CODE
        Is this intentional (NaN check) or a bug (copy-paste error)?
      confidence_threshold: 0.7
`);

// Mock LLM: NaN checks use !== or !=, everything else is a bug
const model = createMockModelFromFn((prompt) => {
  const codeMatch = prompt.match(/itself:\s*(.*)/);
  const code = codeMatch?.[1]?.trim() ?? "";

  // NaN check pattern: value !== value or num != num
  const isNanCheck = code.includes("!==") || code.includes("!=");

  return {
    isViolation: !isNanCheck,
    confidence: 0.93,
    reasoning: isNanCheck
      ? "Intentional NaN check (value !== value is true only for NaN)"
      : "Tautological comparison — likely a copy-paste bug",
  };
});

// Simulate Semgrep finding $X == $X patterns
function setupSemgrepMock() {
  const findings = [
    // role === role (line 7)
    {
      location: { filePath: "tautological-checks.ts", startLine: 7, startColumn: 6, endLine: 7, endColumn: 20 },
      message: "comparison of identical values", ruleId: "tautological-compare",
      matchedCode: "role === role",
      metaVariables: { X: "role" },
      annotations: { semgrepCheckId: "tautological-compare" },
    },
    // left == left (line 13)
    {
      location: { filePath: "tautological-checks.ts", startLine: 13, startColumn: 9, endLine: 13, endColumn: 22 },
      message: "comparison of identical values", ruleId: "tautological-compare",
      matchedCode: "left == left",
      metaVariables: { X: "left" },
      annotations: { semgrepCheckId: "tautological-compare" },
    },
    // i === i (line 18)
    {
      location: { filePath: "tautological-checks.ts", startLine: 18, startColumn: 30, endLine: 18, endColumn: 37 },
      message: "comparison of identical values", ruleId: "tautological-compare",
      matchedCode: "i === i",
      metaVariables: { X: "i" },
      annotations: { semgrepCheckId: "tautological-compare" },
    },
    // value !== value (NaN check, line 23)
    {
      location: { filePath: "tautological-checks.ts", startLine: 23, startColumn: 9, endLine: 23, endColumn: 25 },
      message: "comparison of identical values", ruleId: "tautological-compare",
      matchedCode: "value !== value",
      metaVariables: { X: "value" },
      annotations: { semgrepCheckId: "tautological-compare" },
    },
    // num != num (NaN guard, line 29)
    {
      location: { filePath: "tautological-checks.ts", startLine: 29, startColumn: 6, endLine: 29, endColumn: 16 },
      message: "comparison of identical values", ruleId: "tautological-compare",
      matchedCode: "num != num",
      metaVariables: { X: "num" },
      annotations: { semgrepCheckId: "tautological-compare" },
    },
    // status === status (line 34)
    {
      location: { filePath: "tautological-checks.ts", startLine: 34, startColumn: 9, endLine: 34, endColumn: 27 },
      message: "comparison of identical values", ruleId: "tautological-compare",
      matchedCode: "status === status",
      metaVariables: { X: "status" },
      annotations: { semgrepCheckId: "tautological-compare" },
    },
  ];

  mockedRunTool.mockResolvedValue({ findings });
}

describe("Tautological Comparison Detection (Semgrep + LLM)", () => {
  beforeEach(() => {
    setupSemgrepMock();
  });

  it("flags copy-paste bugs (== and ===)", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // role === role, left == left, i === i, status === status
    expect(violations.length).toBe(4);

    const comparisons = violations.map((c) => c.matchedCode);
    expect(comparisons.some((c) => c.includes("role === role"))).toBe(true);
    expect(comparisons.some((c) => c.includes("left == left"))).toBe(true);
    expect(comparisons.some((c) => c.includes("status === status"))).toBe(true);
  });

  it("passes intentional NaN checks (!== and !=)", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // value !== value (NaN check), num != num (NaN guard)
    expect(filtered.length).toBe(2);

    const passedCode = filtered.map((c) => c.matchedCode);
    expect(passedCode.some((c) => c.includes("value !== value"))).toBe(true);
    expect(passedCode.some((c) => c.includes("num != num"))).toBe(true);
  });

  it("Semgrep stage alone finds ALL self-comparisons", async () => {
    const pipeline = buildPipeline(rule, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);
    const allMatches = result.candidates.filter((c) => !c.filtered);

    // All 6 self-comparisons including NaN checks
    expect(allMatches.length).toBe(6);

    expect(result.trace.stages).toHaveLength(1);
    expect(result.trace.stages[0].name).toBe("semgrep");
  });

  it("preserves Semgrep metavariables through pipeline", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    for (const c of result.candidates) {
      expect(c.metaVariables.X).toBeDefined();
      expect(c.metaVariables.X.length).toBeGreaterThan(0);
    }
  });

  it("has correct 2-stage pipeline trace", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[0].name).toBe("semgrep");
    expect(result.trace.stages[1].name).toBe("llm");

    expect(result.trace.stages[0].candidatesOut).toBe(6);
    expect(result.trace.stages[1].candidatesIn).toBe(6);
    expect(result.trace.stages[1].candidatesOut).toBe(4);
  });
});

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

// Use a semgrep rules config file to match all comparison operators
const semgrepRulePath = join(__dirname, "../fixtures/semgrep-configs/tautological-semgrep.yml");

const rule = parseRuleYaml(`
id: no-tautological-comparison
language: typescript
severity: warning
description: "Flag comparisons of a value with itself (likely copy-paste bug)"
pipeline:
  - semgrep:
      rule: "${semgrepRulePath}"
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

describe("Tautological Comparison Detection (Semgrep + LLM)", () => {
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

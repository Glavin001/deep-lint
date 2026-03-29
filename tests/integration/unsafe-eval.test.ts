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
  join(__dirname, "../fixtures/code/eval-usage.js"),
  "utf-8",
);

const file: FileContext = {
  filePath: "eval-usage.js",
  content: fixture,
  language: "javascript",
};

/**
 * Unsafe eval() Detection (ESLint + LLM)
 *
 * WHY DEEP-LINT IS BETTER:
 * - ESLint's no-eval bans ALL eval() calls — but some eval is safe
 *   (build scripts, hardcoded strings, dev-only code)
 * - ESLint alone can't distinguish eval("constant") from eval(userInput)
 * - Deep-lint: ESLint stage finds all eval() calls quickly using its mature
 *   AST parser, then LLM evaluates whether the input is user-controlled
 *   (dangerous) or trusted/static (safe). You get ESLint's zero-config
 *   detection PLUS semantic understanding.
 */
const rule = parseRuleYaml(`
id: no-unsafe-eval
language: javascript
severity: error
description: "Flag eval() with untrusted input, allow eval of trusted/static content"
pipeline:
  - eslint:
      rules:
        no-eval: error
  - llm:
      prompt: |
        ESLint flagged this eval() call. Is the input user-controlled (dangerous)
        or trusted/static (safe)?

        Code:
        $SURROUNDING(3)
      confidence_threshold: 0.8
`);

// Mock LLM: check if eval context seems user-controlled
// Uses surrounding context to determine if the eval is safe or dangerous
const model = createMockModelFromFn((prompt) => {
  const codeMatch = prompt.match(/Code:\s*\n([\s\S]+?)$/);
  const code = codeMatch?.[1]?.trim() ?? "";

  // Safe patterns: hardcoded strings, sanitized code, dev-only checks
  const safePatterns = [
    "sanitized", "NODE_ENV", "formula", "code",
  ];
  const isSafe = safePatterns.some((p) => code.includes(p));

  // Dangerous: everything else (userInput, script, expr, body, expression from network)
  const isDangerous = !isSafe;

  return {
    isViolation: isDangerous,
    confidence: 0.92,
    reasoning: isDangerous
      ? "eval() with potentially untrusted input — code injection risk"
      : "eval() with trusted/static input — acceptable",
  };
});

describe("Unsafe eval() Detection (ESLint + LLM)", () => {
  it("flags eval() with user-controlled input", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // eval(userInput), eval(script), eval(expr)
    // These don't contain safe patterns (sanitized, NODE_ENV, formula, code)
    expect(violations.length).toBe(3);

    const violationContext = violations.map((c) => c.matchedCode);
    expect(violationContext.some((c) => c.includes("userInput") || c.includes("eval"))).toBe(true);
  });

  it("passes eval() with static/trusted content after LLM review", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // eval(code) — contains "code" safe pattern
    // eval(expression) — surrounding context contains "NODE_ENV"
    // eval(formula) — contains "formula" safe pattern
    expect(filtered.length).toBe(3);
  });

  it("ESLint stage alone finds ALL eval() calls without LLM filtering", async () => {
    const pipeline = buildPipeline(rule, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);
    const allEvals = result.candidates.filter((c) => !c.filtered);

    // All eval() calls found by ESLint (6 total)
    expect(allEvals.length).toBe(6);

    expect(result.trace.stages).toHaveLength(1);
    expect(result.trace.stages[0].name).toBe("eslint");
  });

  it("has correct 2-stage pipeline trace", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[0].name).toBe("eslint");
    expect(result.trace.stages[1].name).toBe("llm");

    // LLM should filter some safe evals
    expect(result.trace.stages[1].candidatesOut).toBeLessThan(
      result.trace.stages[1].candidatesIn,
    );
  });
});

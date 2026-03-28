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

// Mock runTool since ESLint may not be installed in test environment
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
  join(__dirname, "../fixtures/code/eval-usage.ts"),
  "utf-8",
);

const file: FileContext = {
  filePath: "eval-usage.ts",
  content: fixture,
  language: "typescript",
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
language: typescript
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

        Code: $MATCHED_CODE
      confidence_threshold: 0.8
`);

// Mock LLM: check if eval input seems user-controlled
// In a real scenario, the LLM would read the full function context via $MATCHED_CODE
// Here we simulate by checking the variable name passed to eval
const model = createMockModelFromFn((prompt) => {
  const codeMatch = prompt.match(/Code:\s*([\s\S]+?)$/);
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

// Simulate ESLint finding eval() calls at specific lines
function setupEslintMock() {
  const lines = fixture.split("\n");
  const evalFindings = [];

  for (let i = 0; i < lines.length; i++) {
    const col = lines[i].indexOf("eval(");
    if (col !== -1) {
      // Find the end of the eval expression
      let endCol = lines[i].indexOf(");", col);
      if (endCol === -1) endCol = lines[i].length;
      else endCol += 2;

      evalFindings.push({
        location: {
          filePath: "eval-usage.ts",
          startLine: i + 1,
          startColumn: col,
          endLine: i + 1,
          endColumn: endCol,
        },
        message: "eval can be harmful.",
        ruleId: "no-eval",
        matchedCode: lines[i].substring(col, endCol),
        annotations: { eslintSeverity: 2, eslintRuleId: "no-eval" },
      });
    }
  }

  mockedRunTool.mockResolvedValue({ findings: evalFindings });
}

describe("Unsafe eval() Detection (ESLint + LLM)", () => {
  beforeEach(() => {
    setupEslintMock();
  });

  it("flags eval() with user-controlled input", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // eval(userInput), eval(script), eval(expr), eval(expression)
    // These don't contain safe patterns (sanitized, NODE_ENV, formula, code)
    expect(violations.length).toBe(4);

    const violationCode = violations.map((c) => c.matchedCode);
    expect(violationCode.some((c) => c.includes("userInput"))).toBe(true);
    expect(violationCode.some((c) => c.includes("script"))).toBe(true);
    expect(violationCode.some((c) => c.includes("expr"))).toBe(true);
  });

  it("passes eval() with static/trusted content after LLM review", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // eval(code) — contains "code" safe pattern (sanitized input)
    // eval(formula) — contains "formula" safe pattern (hardcoded math)
    expect(filtered.length).toBe(2);
  });

  it("ESLint stage alone finds ALL eval() calls without LLM filtering", async () => {
    const pipeline = buildPipeline(rule, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);
    const allEvals = result.candidates.filter((c) => !c.filtered);

    // All eval() calls found by ESLint, none filtered yet
    expect(allEvals.length).toBeGreaterThanOrEqual(5);

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

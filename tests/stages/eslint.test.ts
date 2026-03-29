import { describe, it, expect } from "vitest";
import type { Candidate } from "../../src/core/candidate.js";
import type { FileContext } from "../../src/types.js";
import { createEslintStage } from "../../src/stages/eslint.js";

const fileContext: FileContext = {
  filePath: "test.js",
  content: 'eval("code");\nconst x = 1;\nvar y = 2;\n',
  language: "javascript",
};

function makeSeedCandidate(fc: FileContext = fileContext): Candidate {
  return {
    id: "",
    ruleId: "test-rule",
    location: { filePath: fc.filePath, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    matchedCode: "",
    metaVariables: {},
    annotations: {},
    filtered: false,
    fileContext: fc,
  };
}

function makeLocatedCandidate(
  startLine: number,
  endLine: number,
  fc: FileContext = fileContext,
): Candidate {
  return {
    id: "located-1",
    ruleId: "test-rule",
    location: { filePath: fc.filePath, startLine, startColumn: 0, endLine, endColumn: 10 },
    matchedCode: "some code",
    metaVariables: {},
    annotations: {},
    filtered: false,
    fileContext: fc,
  };
}

describe("createEslintStage", () => {
  it("creates candidates from ESLint findings in producer mode", async () => {
    const stage = createEslintStage({ rules: { "no-eval": "error", "no-var": "warn" } });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(2);

    // no-eval finding on line 1
    const evalResult = results.find((r) => r.annotations.eslintRuleId === "no-eval");
    expect(evalResult).toBeDefined();
    expect(evalResult!.location.startLine).toBe(1);
    expect(evalResult!.location.filePath).toBe("test.js");
    expect(evalResult!.annotations.eslintSeverity).toBe(2);
    expect(evalResult!.annotations.toolRuleId).toBe("no-eval");
    expect(evalResult!.annotations.toolMessage).toBe("`eval` can be harmful.");
    expect(evalResult!.matchedCode).toBeTruthy();
    expect(evalResult!.ruleId).toBe("test-rule");
    expect(evalResult!.filtered).toBe(false);

    // no-var finding on line 3
    const varResult = results.find((r) => r.annotations.eslintRuleId === "no-var");
    expect(varResult).toBeDefined();
    expect(varResult!.location.startLine).toBe(3);
    expect(varResult!.annotations.eslintSeverity).toBe(1);
  });

  it("filters candidates with no overlapping ESLint findings in filter mode", async () => {
    // Line 1 has eval("code") which triggers no-eval
    const overlapping = makeLocatedCandidate(1, 1);
    // Line 2 has const x = 1 — no no-eval finding here
    const nonOverlapping = makeLocatedCandidate(2, 2);
    nonOverlapping.id = "located-2";

    const stage = createEslintStage({ rules: { "no-eval": "error" } });
    const results = await stage.process([overlapping, nonOverlapping], {});

    expect(results).toHaveLength(2);
    // Overlapping candidate is kept
    expect(results[0].filtered).toBe(false);
    expect(results[0].annotations.eslintRuleId).toBe("no-eval");
    // Non-overlapping candidate is filtered out
    expect(results[1].filtered).toBe(true);
  });

  it("passes through already-filtered candidates untouched", async () => {
    const filtered: Candidate = { ...makeSeedCandidate(), filtered: true };
    const stage = createEslintStage({ rules: { "no-eval": "error" } });
    const results = await stage.process([filtered], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].matchedCode).toBe("");
  });

  it("creates no candidates when findings are empty", async () => {
    // Use a rule that won't match the content
    const stage = createEslintStage({ rules: { "no-debugger": "error" } });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(0);
  });
});

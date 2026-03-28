import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Candidate } from "../../src/core/candidate.js";
import type { FileContext } from "../../src/types.js";

vi.mock("../../src/stages/tool-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/stages/tool-runner.js")>();
  return {
    ...actual,
    runTool: vi.fn(),
  };
});

import { runTool } from "../../src/stages/tool-runner.js";
import { createEslintStage } from "../../src/stages/eslint.js";

const mockedRunTool = vi.mocked(runTool);

const fileContext: FileContext = {
  filePath: "test.ts",
  content: 'eval("code");\nconst x = 1;\nvar y = 2;\n',
  language: "typescript",
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

beforeEach(() => {
  mockedRunTool.mockReset();
});

describe("createEslintStage", () => {
  it("creates candidates from ESLint findings in producer mode", async () => {
    mockedRunTool.mockResolvedValue({
      findings: [
        {
          location: { filePath: "test.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 13 },
          message: "eval can be harmful",
          ruleId: "no-eval",
          annotations: { eslintSeverity: 2, eslintRuleId: "no-eval" },
        },
        {
          location: { filePath: "test.ts", startLine: 3, startColumn: 0, endLine: 3, endColumn: 9 },
          message: "Unexpected var, use let or const instead",
          ruleId: "no-var",
          annotations: { eslintSeverity: 1, eslintRuleId: "no-var" },
        },
      ],
    });

    const stage = createEslintStage({ rules: { "no-eval": "error", "no-var": "warn" } });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(2);

    expect(results[0].location.startLine).toBe(1);
    expect(results[0].location.endLine).toBe(1);
    expect(results[0].location.filePath).toBe("test.ts");
    expect(results[0].annotations.eslintRuleId).toBe("no-eval");
    expect(results[0].annotations.eslintSeverity).toBe(2);
    expect(results[0].annotations.toolRuleId).toBe("no-eval");
    expect(results[0].annotations.toolMessage).toBe("eval can be harmful");
    expect(results[0].matchedCode).toBe('eval("code");');
    expect(results[0].ruleId).toBe("test-rule");
    expect(results[0].filtered).toBe(false);

    expect(results[1].annotations.eslintRuleId).toBe("no-var");
    expect(results[1].annotations.eslintSeverity).toBe(1);
  });

  it("filters candidates with no overlapping ESLint findings in filter mode", async () => {
    mockedRunTool.mockResolvedValue({
      findings: [
        {
          location: { filePath: "test.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 13 },
          message: "eval can be harmful",
          ruleId: "no-eval",
          annotations: { eslintSeverity: 2, eslintRuleId: "no-eval" },
        },
      ],
    });

    const overlapping = makeLocatedCandidate(1, 1);
    const nonOverlapping = makeLocatedCandidate(3, 3);
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
    mockedRunTool.mockResolvedValue({ findings: [] });

    const filtered: Candidate = { ...makeSeedCandidate(), filtered: true };
    const stage = createEslintStage({ rules: { "no-eval": "error" } });
    const results = await stage.process([filtered], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].matchedCode).toBe("");
    // runTool should not be called for filtered-only candidates
    expect(mockedRunTool).not.toHaveBeenCalled();
  });

  it("creates no candidates when findings are empty", async () => {
    mockedRunTool.mockResolvedValue({ findings: [] });

    const stage = createEslintStage({ rules: { "no-eval": "error" } });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(0);
  });
});

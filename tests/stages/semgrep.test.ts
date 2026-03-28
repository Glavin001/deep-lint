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
import { createSemgrepStage } from "../../src/stages/semgrep.js";

const mockedRunTool = vi.mocked(runTool);

const fileContext: FileContext = {
  filePath: "test.py",
  content: 'x = eval(input())\ny = 42\n',
  language: "python",
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

describe("createSemgrepStage", () => {
  it("creates candidates from Semgrep results with metavariables mapped", async () => {
    mockedRunTool.mockResolvedValue({
      findings: [
        {
          location: { filePath: "test.py", startLine: 1, startColumn: 0, endLine: 1, endColumn: 17 },
          message: "Use of eval detected",
          ruleId: "python.lang.security.eval",
          matchedCode: "x = eval(input())",
          metaVariables: { X: "input()" },
          annotations: {
            semgrepCheckId: "python.lang.security.eval",
            semgrepMetadata: { cwe: "CWE-95" },
          },
        },
      ],
    });

    const stage = createSemgrepStage({ pattern: "eval($X)", language: "python" });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(1);
    expect(results[0].location.startLine).toBe(1);
    expect(results[0].location.endLine).toBe(1);
    expect(results[0].location.filePath).toBe("test.py");
    // Metavariable $X should be mapped to X (without the $ prefix)
    expect(results[0].metaVariables.X).toBe("input()");
    expect(results[0].annotations.semgrepCheckId).toBe("python.lang.security.eval");
    expect(results[0].annotations.toolRuleId).toBe("python.lang.security.eval");
    expect(results[0].annotations.toolMessage).toBe("Use of eval detected");
    expect(results[0].matchedCode).toBe("x = eval(input())");
    expect(results[0].ruleId).toBe("test-rule");
    expect(results[0].filtered).toBe(false);
  });

  it("filters candidates with no overlapping Semgrep findings in filter mode", async () => {
    mockedRunTool.mockResolvedValue({
      findings: [
        {
          location: { filePath: "test.py", startLine: 1, startColumn: 0, endLine: 1, endColumn: 17 },
          message: "Use of eval detected",
          ruleId: "python.lang.security.eval",
          annotations: { semgrepCheckId: "python.lang.security.eval" },
        },
      ],
    });

    const overlapping = makeLocatedCandidate(1, 1);
    const nonOverlapping = makeLocatedCandidate(2, 2);
    nonOverlapping.id = "located-2";

    const stage = createSemgrepStage({ pattern: "eval($X)", language: "python" });
    const results = await stage.process([overlapping, nonOverlapping], {});

    expect(results).toHaveLength(2);
    expect(results[0].filtered).toBe(false);
    expect(results[0].annotations.semgrepCheckId).toBe("python.lang.security.eval");
    expect(results[1].filtered).toBe(true);
  });

  it("throws if neither pattern nor rule is provided", () => {
    expect(() => createSemgrepStage({})).toThrow(
      "Semgrep stage requires either 'pattern' or 'rule' config",
    );
  });

  it("passes through already-filtered candidates untouched", async () => {
    mockedRunTool.mockResolvedValue({ findings: [] });

    const filtered: Candidate = { ...makeSeedCandidate(), filtered: true };
    const stage = createSemgrepStage({ pattern: "eval($X)" });
    const results = await stage.process([filtered], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].matchedCode).toBe("");
    expect(mockedRunTool).not.toHaveBeenCalled();
  });
});

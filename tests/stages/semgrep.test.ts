import { describe, it, expect } from "vitest";
import type { Candidate } from "../../src/core/candidate.js";
import type { FileContext } from "../../src/types.js";
import { createSemgrepStage } from "../../src/stages/semgrep.js";

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

describe("createSemgrepStage", () => {
  it("creates candidates from Semgrep results in producer mode", async () => {
    const stage = createSemgrepStage({ pattern: "eval(...)", language: "python" });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(1);
    expect(results[0].location.startLine).toBe(1);
    expect(results[0].location.filePath).toBe("test.py");
    expect(results[0].annotations.semgrepCheckId).toBeDefined();
    expect(results[0].annotations.toolRuleId).toBeDefined();
    expect(results[0].annotations.toolMessage).toBeDefined();
    expect(results[0].matchedCode).toBeTruthy();
    expect(results[0].ruleId).toBe("test-rule");
    expect(results[0].filtered).toBe(false);
  });

  it("filters candidates with no overlapping Semgrep findings in filter mode", async () => {
    // Line 1 has eval(input()) — matches the pattern
    const overlapping = makeLocatedCandidate(1, 1);
    // Line 2 has y = 42 — no match
    const nonOverlapping = makeLocatedCandidate(2, 2);
    nonOverlapping.id = "located-2";

    const stage = createSemgrepStage({ pattern: "eval(...)", language: "python" });
    const results = await stage.process([overlapping, nonOverlapping], {});

    expect(results).toHaveLength(2);
    expect(results[0].filtered).toBe(false);
    expect(results[0].annotations.semgrepCheckId).toBeDefined();
    expect(results[1].filtered).toBe(true);
  });

  it("throws if neither pattern nor rule is provided", () => {
    expect(() => createSemgrepStage({})).toThrow(
      "Semgrep stage requires either 'pattern' or 'rule' config",
    );
  });

  it("passes through already-filtered candidates untouched", async () => {
    const filtered: Candidate = { ...makeSeedCandidate(), filtered: true };
    const stage = createSemgrepStage({ pattern: "eval(...)" });
    const results = await stage.process([filtered], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].matchedCode).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import type { Candidate } from "../../src/core/candidate.js";
import type { FileContext } from "../../src/types.js";
import { createRuffStage } from "../../src/stages/ruff.js";

const fileContext: FileContext = {
  filePath: "test.py",
  content: 'import os\nimport sys\nx = 1\n',
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

describe("createRuffStage", () => {
  it("creates candidates from Ruff diagnostics in producer mode", async () => {
    const stage = createRuffStage({ select: ["F401"] });
    const results = await stage.process([makeSeedCandidate()], {});

    // Ruff should find unused imports: os and sys
    expect(results).toHaveLength(2);

    expect(results[0].location.startLine).toBe(1);
    expect(results[0].location.filePath).toBe("test.py");
    expect(results[0].annotations.ruffCode).toBe("F401");
    expect(results[0].annotations.toolRuleId).toBe("F401");
    expect(results[0].annotations.toolMessage).toBeTruthy();
    expect(results[0].matchedCode).toBeTruthy();
    expect(results[0].ruleId).toBe("test-rule");
    expect(results[0].filtered).toBe(false);

    expect(results[1].location.startLine).toBe(2);
    expect(results[1].annotations.ruffCode).toBe("F401");
  });

  it("filters candidates with no overlapping Ruff findings in filter mode", async () => {
    // Line 1 has import os — triggers F401
    const overlapping = makeLocatedCandidate(1, 1);
    // Line 3 has x = 1 — no F401 finding here
    const nonOverlapping = makeLocatedCandidate(3, 3);
    nonOverlapping.id = "located-2";

    const stage = createRuffStage({ select: ["F401"] });
    const results = await stage.process([overlapping, nonOverlapping], {});

    expect(results).toHaveLength(2);
    expect(results[0].filtered).toBe(false);
    expect(results[0].annotations.ruffCode).toBe("F401");
    expect(results[1].filtered).toBe(true);
  });

  it("throws if select is empty", () => {
    expect(() => createRuffStage({ select: [] })).toThrow(
      "Ruff stage requires a non-empty 'select' array of rule codes",
    );
  });

  it("passes through already-filtered candidates untouched", async () => {
    const filtered: Candidate = { ...makeSeedCandidate(), filtered: true };
    const stage = createRuffStage({ select: ["F401"] });
    const results = await stage.process([filtered], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].matchedCode).toBe("");
  });
});

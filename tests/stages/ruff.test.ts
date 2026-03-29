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
import { createRuffStage } from "../../src/stages/ruff.js";

const mockedRunTool = vi.mocked(runTool);

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

beforeEach(() => {
  mockedRunTool.mockReset();
});

describe("createRuffStage", () => {
  it("creates candidates from Ruff diagnostics in producer mode", async () => {
    mockedRunTool.mockResolvedValue({
      findings: [
        {
          location: { filePath: "test.py", startLine: 1, startColumn: 0, endLine: 1, endColumn: 9 },
          message: "`os` imported but unused",
          ruleId: "F401",
          annotations: { ruffCode: "F401" },
        },
        {
          location: { filePath: "test.py", startLine: 2, startColumn: 0, endLine: 2, endColumn: 10 },
          message: "`sys` imported but unused",
          ruleId: "F401",
          annotations: { ruffCode: "F401" },
        },
      ],
    });

    const stage = createRuffStage({ select: ["F401"] });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(2);

    expect(results[0].location.startLine).toBe(1);
    expect(results[0].location.endLine).toBe(1);
    expect(results[0].location.filePath).toBe("test.py");
    expect(results[0].annotations.ruffCode).toBe("F401");
    expect(results[0].annotations.toolRuleId).toBe("F401");
    expect(results[0].annotations.toolMessage).toBe("`os` imported but unused");
    expect(results[0].matchedCode).toBe("import os");
    expect(results[0].ruleId).toBe("test-rule");
    expect(results[0].filtered).toBe(false);

    expect(results[1].location.startLine).toBe(2);
    expect(results[1].annotations.ruffCode).toBe("F401");
  });

  it("filters candidates with no overlapping Ruff findings in filter mode", async () => {
    mockedRunTool.mockResolvedValue({
      findings: [
        {
          location: { filePath: "test.py", startLine: 1, startColumn: 0, endLine: 1, endColumn: 9 },
          message: "`os` imported but unused",
          ruleId: "F401",
          annotations: { ruffCode: "F401" },
        },
      ],
    });

    const overlapping = makeLocatedCandidate(1, 1);
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
    mockedRunTool.mockResolvedValue({ findings: [] });

    const filtered: Candidate = { ...makeSeedCandidate(), filtered: true };
    const stage = createRuffStage({ select: ["F401"] });
    const results = await stage.process([filtered], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].matchedCode).toBe("");
    expect(mockedRunTool).not.toHaveBeenCalled();
  });
});

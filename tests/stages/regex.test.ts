import { describe, it, expect } from "vitest";
import { createRegexStage } from "../../src/stages/regex.js";
import type { Candidate } from "../../src/core/candidate.js";
import type { FileContext } from "../../src/types.js";

const fileContext: FileContext = {
  filePath: "test.ts",
  content: `// TODO: fix this bug
const x = 42;
// FIXME(#123): handle edge case
function hello() {}
// HACK: temporary workaround
`,
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

function makeCandidate(matchedCode: string, fc: FileContext = fileContext): Candidate {
  return {
    id: "test-id",
    ruleId: "test-rule",
    location: { filePath: fc.filePath, startLine: 1, startColumn: 0, endLine: 1, endColumn: matchedCode.length },
    matchedCode,
    metaVariables: {},
    annotations: {},
    filtered: false,
    fileContext: fc,
  };
}

describe("createRegexStage — producer mode", () => {
  it("finds simple pattern matches and creates candidates with correct locations", async () => {
    const stage = createRegexStage({ pattern: "TODO|FIXME|HACK" });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(3);
    expect(results[0].matchedCode).toBe("TODO");
    expect(results[0].location.startLine).toBe(1);
    expect(results[0].location.filePath).toBe("test.ts");

    expect(results[1].matchedCode).toBe("FIXME");
    expect(results[1].location.startLine).toBe(3);

    expect(results[2].matchedCode).toBe("HACK");
    expect(results[2].location.startLine).toBe(5);

    // Columns should reflect match position within the line
    for (const r of results) {
      expect(r.location.startColumn).toBeGreaterThanOrEqual(0);
      expect(r.location.endColumn).toBeGreaterThan(r.location.startColumn);
    }
  });

  it("extracts named capture groups as metaVariables", async () => {
    const stage = createRegexStage({ pattern: "(?<tag>TODO|FIXME|HACK)(?<message>.*)" });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(3);
    expect(results[0].metaVariables.tag).toBe("TODO");
    expect(results[0].metaVariables.message).toBe(": fix this bug");

    expect(results[1].metaVariables.tag).toBe("FIXME");
    expect(results[1].metaVariables.message).toBe("(#123): handle edge case");

    expect(results[2].metaVariables.tag).toBe("HACK");
    expect(results[2].metaVariables.message).toBe(": temporary workaround");
  });

  it("extracts positional capture groups as numbered metaVariables", async () => {
    const stage = createRegexStage({ pattern: "(TODO|FIXME|HACK)(:\\s*)(.*)" });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results.length).toBeGreaterThan(0);
    // $1 = tag, $2 = colon+space, $3 = message
    expect(results[0].metaVariables["1"]).toBe("TODO");
    expect(results[0].metaVariables["2"]).toBe(": ");
    expect(results[0].metaVariables["3"]).toBe("fix this bug");
  });

  it("supports case-insensitive flag", async () => {
    const stage = createRegexStage({ pattern: "todo", flags: "i" });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(1);
    expect(results[0].matchedCode).toBe("TODO");
  });

  it("returns empty array when no matches", async () => {
    const stage = createRegexStage({ pattern: "NONEXISTENT_PATTERN_XYZ" });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(0);
  });

  it("handles multiple matches on the same line", async () => {
    const fc: FileContext = {
      filePath: "multi.ts",
      content: "aaa bbb aaa bbb aaa",
      language: "typescript",
    };
    const stage = createRegexStage({ pattern: "aaa" });
    const results = await stage.process([makeSeedCandidate(fc)], {});

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.matchedCode).toBe("aaa");
      expect(r.location.startLine).toBe(1);
    }
    // Columns should differ
    const columns = results.map((r) => r.location.startColumn);
    expect(new Set(columns).size).toBe(3);
  });

  it("handles multiple files", async () => {
    const file2: FileContext = {
      filePath: "other.ts",
      content: "// TODO: another item\n",
      language: "typescript",
    };
    const stage = createRegexStage({ pattern: "TODO" });
    const results = await stage.process(
      [makeSeedCandidate(fileContext), makeSeedCandidate(file2)],
      {},
    );

    const fromFile1 = results.filter((r) => r.location.filePath === "test.ts");
    const fromFile2 = results.filter((r) => r.location.filePath === "other.ts");
    expect(fromFile1).toHaveLength(1);
    expect(fromFile2).toHaveLength(1);
  });

  it("generates deterministic candidate ids", async () => {
    const stage = createRegexStage({ pattern: "TODO" });
    const results1 = await stage.process([makeSeedCandidate()], {});
    const results2 = await stage.process([makeSeedCandidate()], {});

    expect(results1.length).toBe(results2.length);
    for (let i = 0; i < results1.length; i++) {
      expect(results1[i].id).toBe(results2[i].id);
      expect(results1[i].id).not.toBe("");
    }
  });

  it("passes through filtered candidates untouched", async () => {
    const filtered: Candidate = { ...makeSeedCandidate(), filtered: true };
    const stage = createRegexStage({ pattern: "TODO" });
    const results = await stage.process([filtered], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].matchedCode).toBe("");
  });
});

describe("createRegexStage — filter mode", () => {
  it("keeps candidates whose matchedCode matches the pattern", async () => {
    const stage = createRegexStage({ pattern: "\\d+" });
    const results = await stage.process(
      [makeCandidate("const x = 42;"), makeCandidate("const y = 99;")],
      {},
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.filtered)).toBe(true);
  });

  it("filters out candidates whose matchedCode does not match", async () => {
    const stage = createRegexStage({ pattern: "\\d+" });
    const results = await stage.process(
      [makeCandidate("const x = 42;"), makeCandidate("const y = foo;")],
      {},
    );

    expect(results).toHaveLength(2);
    const kept = results.filter((r) => !r.filtered);
    const filtered = results.filter((r) => r.filtered);
    expect(kept).toHaveLength(1);
    expect(kept[0].matchedCode).toBe("const x = 42;");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].matchedCode).toBe("const y = foo;");
  });

  it("invert: true filters OUT matches and keeps non-matches", async () => {
    const stage = createRegexStage({ pattern: "\\d+", invert: true });
    const results = await stage.process(
      [makeCandidate("const x = 42;"), makeCandidate("const y = foo;")],
      {},
    );

    expect(results).toHaveLength(2);
    const kept = results.filter((r) => !r.filtered);
    const filtered = results.filter((r) => r.filtered);
    // invert: match => filtered, non-match => kept
    expect(kept).toHaveLength(1);
    expect(kept[0].matchedCode).toBe("const y = foo;");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].matchedCode).toBe("const x = 42;");
  });

  it("extracts capture groups into metaVariables during filtering", async () => {
    const stage = createRegexStage({ pattern: "const (\\w+) = (\\w+)" });
    const results = await stage.process([makeCandidate("const x = 42;")], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(false);
    expect(results[0].metaVariables["1"]).toBe("x");
    expect(results[0].metaVariables["2"]).toBe("42");
  });

  it("extracts named capture groups into metaVariables during filtering", async () => {
    const stage = createRegexStage({ pattern: "const (?<name>\\w+) = (?<value>\\w+)" });
    const results = await stage.process([makeCandidate("const x = 42;")], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(false);
    expect(results[0].metaVariables.name).toBe("x");
    expect(results[0].metaVariables.value).toBe("42");
  });

  it("passes through already-filtered candidates untouched", async () => {
    const filtered: Candidate = { ...makeCandidate("const x = 42;"), filtered: true };
    const stage = createRegexStage({ pattern: "NEVER_MATCH_THIS" });
    const results = await stage.process([filtered], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].matchedCode).toBe("const x = 42;");
  });

  it("preserves existing metaVariables when adding new ones", async () => {
    const candidate: Candidate = {
      ...makeCandidate("const x = 42;"),
      metaVariables: { existing: "value" },
    };
    const stage = createRegexStage({ pattern: "const (\\w+)" });
    const results = await stage.process([candidate], {});

    expect(results).toHaveLength(1);
    expect(results[0].metaVariables.existing).toBe("value");
    expect(results[0].metaVariables["1"]).toBe("x");
  });
});

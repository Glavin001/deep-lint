import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAstGrepStage, resolveAstGrepLang } from "../../src/stages/ast-grep.js";
import type { Candidate } from "../../src/core/candidate.js";
import type { FileContext } from "../../src/types.js";

const fixtureContent = readFileSync(
  join(__dirname, "../fixtures/code/example.ts"),
  "utf-8",
);

const fileContext: FileContext = {
  filePath: "tests/fixtures/code/example.ts",
  content: fixtureContent,
  language: "typescript",
};

function makeSeedCandidate(fc: FileContext = fileContext): Candidate {
  return {
    id: "",
    ruleId: "test-rule",
    location: {
      filePath: fc.filePath,
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 0,
    },
    matchedCode: "",
    metaVariables: {},
    annotations: {},
    filtered: false,
    fileContext: fc,
  };
}

describe("resolveAstGrepLang", () => {
  it("maps typescript to TypeScript", () => {
    expect(resolveAstGrepLang("typescript")).toBe("TypeScript");
  });

  it("maps javascript to JavaScript", () => {
    expect(resolveAstGrepLang("javascript")).toBe("JavaScript");
  });

  it("throws for unsupported language", () => {
    expect(() => resolveAstGrepLang("ruby" as any)).toThrow("Unsupported language");
  });
});

describe("createAstGrepStage", () => {
  it("finds console.log calls", async () => {
    const stage = createAstGrepStage({ pattern: "console.log($$$ARGS)" });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results.length).toBe(2);
    expect(results[0].matchedCode).toContain("console.log");
    expect(results[1].matchedCode).toContain("console.log");
  });

  it("extracts single metavariables", async () => {
    const stage = createAstGrepStage({ pattern: "function $FUNC($$$PARAMS) { $$$BODY }" });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results.length).toBeGreaterThan(0);
    const funcNames = results.map((r) => r.metaVariables.FUNC);
    expect(funcNames).toContain("greet");
    expect(funcNames).toContain("cleanFunction");
  });

  it("sets correct locations (1-indexed lines)", async () => {
    const stage = createAstGrepStage({ pattern: "console.log($$$ARGS)" });
    const results = await stage.process([makeSeedCandidate()], {});

    // Lines should be 1-indexed
    for (const result of results) {
      expect(result.location.startLine).toBeGreaterThanOrEqual(1);
      expect(result.location.endLine).toBeGreaterThanOrEqual(result.location.startLine);
      expect(result.location.filePath).toBe(fileContext.filePath);
    }
  });

  it("generates deterministic candidate ids", async () => {
    const stage = createAstGrepStage({ pattern: "console.log($$$ARGS)" });
    const results1 = await stage.process([makeSeedCandidate()], {});
    const results2 = await stage.process([makeSeedCandidate()], {});

    expect(results1.length).toBe(results2.length);
    for (let i = 0; i < results1.length; i++) {
      expect(results1[i].id).toBe(results2[i].id);
    }
  });

  it("passes through filtered candidates untouched", async () => {
    const filtered: Candidate = {
      ...makeSeedCandidate(),
      filtered: true,
    };
    const stage = createAstGrepStage({ pattern: "console.log($$$ARGS)" });
    const results = await stage.process([filtered], {});

    expect(results).toHaveLength(1);
    expect(results[0].filtered).toBe(true);
    expect(results[0].matchedCode).toBe("");
  });

  it("returns empty for no matches", async () => {
    const stage = createAstGrepStage({ pattern: "nonexistent.method()" });
    const results = await stage.process([makeSeedCandidate()], {});

    expect(results).toHaveLength(0);
  });

  it("handles multiple files", async () => {
    const file2: FileContext = {
      filePath: "other.ts",
      content: 'console.log("extra");',
      language: "typescript",
    };
    const stage = createAstGrepStage({ pattern: "console.log($$$ARGS)" });
    const results = await stage.process(
      [makeSeedCandidate(fileContext), makeSeedCandidate(file2)],
      {},
    );

    const fromFile1 = results.filter((r) => r.location.filePath === fileContext.filePath);
    const fromFile2 = results.filter((r) => r.location.filePath === "other.ts");
    expect(fromFile1.length).toBe(2);
    expect(fromFile2.length).toBe(1);
  });

  it("handles inline source content", async () => {
    const fc: FileContext = {
      filePath: "inline.ts",
      content: "const x = 1 as any;",
      language: "typescript",
    };
    const stage = createAstGrepStage({ pattern: "$X as any" });
    const results = await stage.process([makeSeedCandidate(fc)], {});

    expect(results.length).toBe(1);
    expect(results[0].metaVariables.X).toBe("1");
  });
});

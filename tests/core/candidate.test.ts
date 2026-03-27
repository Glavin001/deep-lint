import { describe, it, expect } from "vitest";
import { createCandidate } from "../../src/core/candidate.js";
import type { FileContext, Location } from "../../src/types.js";

const fileContext: FileContext = {
  filePath: "test.ts",
  content: 'console.log("hello");',
  language: "typescript",
};

const location: Location = {
  filePath: "test.ts",
  startLine: 1,
  startColumn: 0,
  endLine: 1,
  endColumn: 21,
};

describe("createCandidate", () => {
  it("creates a candidate with default values", () => {
    const candidate = createCandidate({
      ruleId: "no-console-log",
      location,
      matchedCode: 'console.log("hello")',
      fileContext,
    });

    expect(candidate.id).toBeTypeOf("string");
    expect(candidate.id).toHaveLength(16);
    expect(candidate.ruleId).toBe("no-console-log");
    expect(candidate.location).toEqual(location);
    expect(candidate.matchedCode).toBe('console.log("hello")');
    expect(candidate.metaVariables).toEqual({});
    expect(candidate.annotations).toEqual({});
    expect(candidate.filtered).toBe(false);
    expect(candidate.fileContext).toBe(fileContext);
  });

  it("accepts metaVariables", () => {
    const candidate = createCandidate({
      ruleId: "test-rule",
      location,
      matchedCode: 'console.log("hello")',
      metaVariables: { ARGS: '"hello"' },
      fileContext,
    });

    expect(candidate.metaVariables).toEqual({ ARGS: '"hello"' });
  });

  it("generates deterministic ids for same input", () => {
    const opts = {
      ruleId: "test-rule",
      location,
      matchedCode: 'console.log("hello")',
      fileContext,
    };

    const a = createCandidate(opts);
    const b = createCandidate(opts);
    expect(a.id).toBe(b.id);
  });

  it("generates different ids for different locations", () => {
    const a = createCandidate({
      ruleId: "test-rule",
      location,
      matchedCode: "code",
      fileContext,
    });

    const b = createCandidate({
      ruleId: "test-rule",
      location: { ...location, startLine: 5 },
      matchedCode: "code",
      fileContext,
    });

    expect(a.id).not.toBe(b.id);
  });
});

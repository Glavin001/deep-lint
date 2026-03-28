import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRuleYaml,
  buildPipeline,
  executePipeline,
  type FileContext,
} from "../../src/index.js";
import { createMockModelFromFn } from "../fixtures/helpers/mock-llm.js";

const fixture = readFileSync(
  join(__dirname, "../fixtures/code/sql-queries.ts"),
  "utf-8",
);

const file: FileContext = {
  filePath: "sql-queries.ts",
  content: fixture,
  language: "typescript",
};

/**
 * SQL Injection Detection
 *
 * WHY ONLY DEEP-LINT CAN DO THIS:
 * - ast-grep alone can find db.query() calls but can't distinguish
 *   parameterized queries from string concatenation
 * - ESLint has no built-in rule for arbitrary DB APIs and can't match
 *   structural patterns like db.query($INPUT)
 * - Deep-lint: ast-grep narrows to DB calls, LLM analyzes whether the
 *   input is safely parameterized or uses dangerous string interpolation
 */
const rule = parseRuleYaml(`
id: no-sql-injection
language: typescript
severity: error
description: "Database queries must use parameterized inputs, not string concatenation"
pipeline:
  - ast-grep:
      pattern: "db.query($$$ARGS)"
  - llm:
      prompt: |
        Analyze this database query call. Is the query input safely parameterized
        or does it use dangerous string concatenation/template literal interpolation?

        Code:
        $MATCHED_CODE
      confidence_threshold: 0.7
`);

// Mock LLM: detect string concat (+) or template interpolation (${) in matched code
const model = createMockModelFromFn((prompt) => {
  // Extract the matched code section from the prompt
  const codeMatch = prompt.match(/Code:\s*\n([\s\S]+?)$/);
  const code = codeMatch?.[1] ?? "";

  const hasStringConcat = code.includes("' + ") || code.includes("\" + ");
  const hasTemplateInterp = code.includes("${");
  const isUnsafe = hasStringConcat || hasTemplateInterp;

  return {
    isViolation: isUnsafe,
    confidence: 0.92,
    reasoning: isUnsafe
      ? "Query uses string concatenation or template interpolation — SQL injection risk"
      : "Query uses parameterized input or a query builder — safe",
  };
});

describe("SQL Injection Detection (ast-grep + LLM)", () => {
  it("flags unsafe string-concatenated queries", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // findUserByName (string concat), findUserById (template literal),
    // findInTable (string concat) should be flagged
    const violationFuncs = violations.map((c) => {
      const line = c.location.startLine;
      return { line, code: c.matchedCode.substring(0, 60) };
    });

    expect(violations.length).toBe(3);
    expect(violations.some((c) => c.matchedCode.includes("+ name +"))).toBe(true);
    expect(violations.some((c) => c.matchedCode.includes("${id}"))).toBe(true);
    expect(violations.some((c) => c.matchedCode.includes("+ table +"))).toBe(true);
  });

  it("passes safe parameterized and builder queries", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // findUserSafe (parameterized), findUserWithBuilder (builder),
    // getAllUsers (hardcoded) should be filtered out
    expect(filtered.some((c) => c.matchedCode.includes("$1"))).toBe(true);
    expect(filtered.some((c) => c.matchedCode.includes("buildWhereClause"))).toBe(true);
    expect(filtered.some((c) => c.matchedCode.includes("ORDER BY name"))).toBe(true);
  });

  it("attaches LLM annotations to all candidates", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    for (const c of result.candidates) {
      expect(c.annotations.llmConfidence).toBe(0.92);
      expect(c.annotations.llmReasoning).toBeDefined();
    }
  });

  it("has correct pipeline trace", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[0].name).toBe("ast-grep");
    expect(result.trace.stages[0].candidatesOut).toBe(6); // 6 db.query calls
    expect(result.trace.stages[1].name).toBe("llm");
    expect(result.trace.stages[1].candidatesIn).toBe(6);
    expect(result.trace.stages[1].candidatesOut).toBe(3); // 3 unsafe
  });

  it("with --no-llm finds all db.query calls without filtering", async () => {
    const pipeline = buildPipeline(rule, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);
    const active = result.candidates.filter((c) => !c.filtered);

    expect(active.length).toBe(6); // all 6 calls
    expect(result.trace.stages).toHaveLength(1);
  });
});

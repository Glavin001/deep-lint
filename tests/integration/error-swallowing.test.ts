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
  join(__dirname, "../fixtures/code/error-handling.ts"),
  "utf-8",
);

const file: FileContext = {
  filePath: "error-handling.ts",
  content: fixture,
  language: "typescript",
};

/**
 * Error Swallowing — Empty/Useless Catch Blocks
 *
 * WHY ONLY DEEP-LINT CAN DO THIS:
 * - ESLint's no-empty can find empty catch blocks but treats
 *   comment-only catch blocks as "handled"
 * - ast-grep can match catch blocks but can't tell if the body
 *   meaningfully handles the error
 * - Deep-lint: ast-grep finds try/catch blocks, LLM analyzes whether
 *   the catch body actually handles the error (log, rethrow, return
 *   error value) vs swallowing it (empty, comment-only, assign-only)
 */
const rule = parseRuleYaml(`
id: no-error-swallowing
language: typescript
severity: warning
description: "Catch blocks must meaningfully handle errors, not swallow them"
pipeline:
  - ast-grep:
      pattern: "try { $$$TRY } catch ($ERR) { $$$BODY }"
  - llm:
      prompt: |
        Does this catch block meaningfully handle the error?

        Caught error variable: $ERR
        Catch body:
        $MATCHED_CODE

        Meaningful handling includes:
        - Logging the error (console.error, logger.error, console.warn)
        - Rethrowing the error (throw)
        - Returning an error value (return { error: ... })
        - Conditional logic that dispatches on error type

        NOT meaningful (violation):
        - Empty catch block
        - Only a comment (// TODO, /* ignore */)
        - Assigning to a variable that is never used
      confidence_threshold: 0.7
`);

// Mock LLM: inspect the catch body for meaningful handling in matched code only
const model = createMockModelFromFn((prompt) => {
  // Extract only the "Catch body:" section to avoid matching instructional text
  const bodyMatch = prompt.match(/Catch body:\s*\n([\s\S]+?)(?:\n\s*\n\s*Meaningful handling)/);
  const code = bodyMatch?.[1] ?? "";

  // Check for meaningful handling patterns
  const hasLog =
    code.includes("console.error") ||
    code.includes("console.warn") ||
    code.includes("logger.");
  const hasThrow = /\bthrow\b/.test(code);
  const hasReturn = /\breturn\b.*\berror\b/i.test(code) || /\breturn\b.*\bok:\s*false/.test(code);
  const hasConditional = code.includes("instanceof") || code.includes("if (err");

  const isMeaningful = hasLog || hasThrow || hasReturn || hasConditional;

  // Check for non-handling patterns in matched code
  const catchBodyMatch = code.match(/catch\s*\(\w+\)\s*\{([\s\S]*)\}/);
  const catchBody = catchBodyMatch?.[1]?.trim() ?? "";
  const isEmpty = catchBody === "";
  const isCommentOnly = catchBody !== "" && catchBody.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "").trim() === "";
  const isAssignOnly = /^\s*const\s+\w+\s*=\s*\w+;\s*$/.test(catchBody);

  const isSwallowed = !isMeaningful && (isEmpty || isCommentOnly || isAssignOnly || !catchBody);

  return {
    isViolation: isSwallowed,
    confidence: 0.88,
    reasoning: isSwallowed
      ? "Error is swallowed — catch block does not meaningfully handle the error"
      : "Error is properly handled",
  };
});

describe("Error Swallowing Detection (ast-grep + LLM)", () => {
  it("flags empty and useless catch blocks", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // swallowedError (empty), commentOnly (TODO comment), assignOnly (unused var)
    expect(violations.length).toBe(3);
  });

  it("passes catch blocks with meaningful handling", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // loggedError, rethrownError, handledError, complexHandler
    expect(filtered.length).toBe(4);
    expect(filtered.some((c) => c.matchedCode.includes("console.error"))).toBe(true);
    expect(filtered.some((c) => c.matchedCode.includes("throw new Error"))).toBe(true);
    expect(filtered.some((c) => c.matchedCode.includes("return { ok: false"))).toBe(true);
    expect(filtered.some((c) => c.matchedCode.includes("instanceof SyntaxError"))).toBe(true);
  });

  it("captures the error variable name", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    for (const c of result.candidates) {
      expect(c.metaVariables.ERR).toBe("err");
    }
  });

  it("tracks candidate flow through pipeline trace", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[0].name).toBe("ast-grep");
    expect(result.trace.stages[0].candidatesOut).toBe(7);
    expect(result.trace.stages[1].name).toBe("llm");
    expect(result.trace.stages[1].candidatesIn).toBe(7);
    expect(result.trace.stages[1].candidatesOut).toBe(3);
  });
});

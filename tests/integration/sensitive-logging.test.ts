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
  join(__dirname, "../fixtures/code/logging.ts"),
  "utf-8",
);

const file: FileContext = {
  filePath: "logging.ts",
  content: fixture,
  language: "typescript",
};

/**
 * Console.log with Sensitive Data
 *
 * WHY ONLY DEEP-LINT CAN DO THIS:
 * - ESLint's no-console bans ALL console.log — way too aggressive for
 *   debugging in many codebases
 * - ast-grep can find console.log but can't tell if the arguments
 *   reference sensitive data
 * - Deep-lint: ast-grep finds console.log calls, LLM checks if the
 *   logged values reference passwords, tokens, PII, or other secrets
 *   — flagging ONLY the dangerous ones
 */
const rule = parseRuleYaml(`
id: no-sensitive-logging
language: typescript
severity: error
description: "Do not log sensitive data (passwords, tokens, PII)"
pipeline:
  - ast-grep:
      pattern: "console.log($$$ARGS)"
  - llm:
      prompt: |
        Do the arguments to this console.log contain or reference sensitive data?

        Code: $MATCHED_CODE
        Arguments: $ARGS

        Sensitive data includes:
        - Passwords, secrets, tokens, session identifiers
        - PII: SSN, credit card numbers, email addresses in user objects
        - Entire user objects that may contain sensitive fields
        - Auth headers or credentials

        NOT sensitive:
        - Page names, action descriptions, user IDs
        - Counts, metrics, latency numbers
        - Error messages (error.message), status codes
      confidence_threshold: 0.7
`);

// Mock LLM: check if logged content references sensitive fields in matched code only
const model = createMockModelFromFn((prompt) => {
  // Extract only the "Code:" section to avoid matching instructional text
  const codeMatch = prompt.match(/Code:\s*(.*?)(?:\n\s*Arguments:)/s);
  const code = codeMatch?.[1]?.trim() ?? "";

  const sensitivePatterns = [
    "password",
    "Password",
    ".ssn",
    "creditCard",
    "credit_card",
    "sessionToken",
    "session_token",
  ];

  // Logging entire user object is also sensitive
  const logsWholeUser =
    code.includes("console.log") &&
    /,\s*user\)/.test(code);

  const hasSensitive =
    sensitivePatterns.some((p) => code.includes(p)) || logsWholeUser;

  return {
    isViolation: hasSensitive,
    confidence: 0.91,
    reasoning: hasSensitive
      ? "Logging sensitive data — potential data leak"
      : "Logging non-sensitive information",
  };
});

describe("Sensitive Logging Detection (ast-grep + LLM)", () => {
  it("flags console.log with passwords, tokens, PII", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // logUserLogin (password), logUserDetails (whole user object),
    // logSession (sessionToken), logPayment (creditCard), logVerification (ssn)
    expect(violations.length).toBe(5);
    expect(violations.some((c) => c.matchedCode.includes("password"))).toBe(true);
    expect(violations.some((c) => c.matchedCode.includes("sessionToken"))).toBe(true);
    expect(violations.some((c) => c.matchedCode.includes("creditCard"))).toBe(true);
    expect(violations.some((c) => c.matchedCode.includes(".ssn"))).toBe(true);
  });

  it("passes console.log with non-sensitive data", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // logPageView, logUserAction (userId only), logMetrics, logError
    expect(filtered.length).toBe(4);
    expect(filtered.some((c) => c.matchedCode.includes("Page viewed"))).toBe(true);
    expect(filtered.some((c) => c.matchedCode.includes("Requests:"))).toBe(true);
    expect(filtered.some((c) => c.matchedCode.includes("error.message"))).toBe(true);
  });

  it("distinguishes user.password from userId", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    // logUserLogin logs user.password → violation
    const passwordLog = result.candidates.find((c) =>
      c.matchedCode.includes("user.password"),
    );
    expect(passwordLog).toBeDefined();
    expect(passwordLog!.filtered).toBe(false);

    // logUserAction logs userId → not a violation
    const userIdLog = result.candidates.find((c) =>
      c.matchedCode.includes("userId"),
    );
    expect(userIdLog).toBeDefined();
    expect(userIdLog!.filtered).toBe(true);
  });
});

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
  join(__dirname, "../fixtures/code/config-secrets.ts"),
  "utf-8",
);

const file: FileContext = {
  filePath: "config-secrets.ts",
  content: fixture,
  language: "typescript",
};

/**
 * Hardcoded Secrets Detection (Smart, Not Blanket)
 *
 * WHY ONLY DEEP-LINT CAN DO THIS:
 * - ast-grep can find `const $VAR = "$VALUE"` but can't tell an API key
 *   from a greeting string
 * - ESLint can only ban patterns like "no literal strings" which is too broad
 * - Deep-lint: ast-grep finds string constant assignments, LLM checks if
 *   the variable name + value combination looks like a hardcoded secret
 */
const rule = parseRuleYaml(`
id: no-hardcoded-secrets
language: typescript
severity: error
description: "No hardcoded secrets, API keys, or credentials in source code"
pipeline:
  - ast-grep:
      pattern: 'const $VAR = "$VALUE"'
  - llm:
      prompt: |
        Does this constant assignment contain a hardcoded secret, API key,
        password, token, or credential?

        Variable name: $VAR
        Value: $VALUE

        Consider:
        - Variable names containing KEY, SECRET, PASSWORD, TOKEN, CREDENTIAL
        - Values that look like API keys (sk_, pk_, AKIA), JWTs (eyJ), or
          long random strings
        - Short, human-readable strings like "Hello" or "en-US" are NOT secrets
        - URLs, version numbers, and error messages are NOT secrets
      confidence_threshold: 0.8
`);

// Mock LLM: check variable name for secret-like keywords + value entropy
const model = createMockModelFromFn((prompt) => {
  const varMatch = prompt.match(/Variable name:\s*(\S+)/);
  const valueMatch = prompt.match(/Value:\s*(.+)/);
  const varName = varMatch?.[1]?.toUpperCase() ?? "";
  const value = valueMatch?.[1]?.trim() ?? "";

  const secretNamePatterns = ["KEY", "SECRET", "PASSWORD", "TOKEN", "CREDENTIAL", "ACCESS"];
  const hasSecretName = secretNamePatterns.some((p) => varName.includes(p));
  const hasSecretPrefix = /^(sk_|pk_|AKIA|eyJ)/.test(value);
  const isLongValue = value.length > 16;

  const isSecret = hasSecretName && (hasSecretPrefix || isLongValue);

  return {
    isViolation: isSecret,
    confidence: 0.95,
    reasoning: isSecret
      ? `Variable "${varName}" contains what appears to be a hardcoded secret`
      : `Variable "${varName}" does not appear to contain a secret`,
  };
});

describe("Hardcoded Secrets Detection (ast-grep + LLM)", () => {
  it("flags hardcoded API keys, passwords, and tokens", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // STRIPE_SECRET_KEY, DB_PASSWORD, AUTH_TOKEN, AWS_ACCESS_KEY
    expect(violations.length).toBe(4);

    const varNames = violations.map((c) => c.metaVariables.VAR);
    expect(varNames).toContain("STRIPE_SECRET_KEY");
    expect(varNames).toContain("DB_PASSWORD");
    expect(varNames).toContain("AUTH_TOKEN");
    expect(varNames).toContain("AWS_ACCESS_KEY");
  });

  it("passes normal string constants", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    const filteredNames = filtered.map((c) => c.metaVariables.VAR);
    expect(filteredNames).toContain("APP_NAME");
    expect(filteredNames).toContain("DEFAULT_LOCALE");
    expect(filteredNames).toContain("API_BASE_URL");
    expect(filteredNames).toContain("VERSION");
    expect(filteredNames).toContain("ERROR_MESSAGE");
  });

  it("captures metavariables correctly for each match", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    for (const c of result.candidates) {
      expect(c.metaVariables.VAR).toBeDefined();
      expect(c.metaVariables.VALUE).toBeDefined();
      expect(c.metaVariables.VAR.length).toBeGreaterThan(0);
    }
  });

  it("has severity error for secret leaks", async () => {
    expect(rule.severity).toBe("error");
  });
});

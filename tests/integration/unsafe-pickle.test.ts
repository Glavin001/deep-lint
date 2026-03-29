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
  join(__dirname, "../fixtures/code/pickle-usage.py"),
  "utf-8",
);

const file: FileContext = {
  filePath: "pickle-usage.py",
  content: fixture,
  language: "python",
};

/**
 * Unsafe Pickle Deserialization (Ruff + LLM)
 *
 * WHY DEEP-LINT IS BETTER:
 * - Ruff's S301 flags ALL pickle.load/loads calls — but pickle is safe for
 *   trusted data (internal caches, build artifacts, test fixtures)
 * - Ruff alone can't reason about where the data comes from
 * - Bandit (another Python SAST) has the same blanket ban
 * - Deep-lint: Ruff stage finds all pickle usage blazingly fast (Ruff is
 *   the fastest Python linter), then LLM evaluates whether the data source
 *   is trusted or untrusted. You get Ruff's speed PLUS semantic judgment.
 */
const rule = parseRuleYaml(`
id: no-unsafe-pickle
language: python
severity: error
description: "Flag pickle deserialization of untrusted data"
pipeline:
  - ruff:
      select:
        - "S301"
  - llm:
      prompt: |
        Ruff flagged this pickle usage. Is the data source trusted or untrusted?
        Code:
        $SURROUNDING(3)
        File: $FILE_PATH
      confidence_threshold: 0.8
`);

// Mock LLM: check if the data source seems trusted
const model = createMockModelFromFn((prompt) => {
  const codeMatch = prompt.match(/Code:\s*\n([\s\S]+?)(?:\nFile:)/);
  const code = codeMatch?.[1]?.trim() ?? "";

  // Trusted sources: cache, test fixtures, internal paths
  const trustedPatterns = ["cache", "test", "fixture", "internal"];
  const isTrusted = trustedPatterns.some((p) => code.toLowerCase().includes(p));

  // Untrusted sources: user uploads, network, API, external
  const untrustedPatterns = ["user", "upload", "network", "api", "response", "data: bytes"];
  const isUntrusted = untrustedPatterns.some((p) => code.toLowerCase().includes(p));

  const isDangerous = isUntrusted || !isTrusted;

  return {
    isViolation: isDangerous,
    confidence: 0.91,
    reasoning: isDangerous
      ? "Pickle deserialization of untrusted data — remote code execution risk"
      : "Pickle from trusted source (cache/test) — acceptable",
  };
});

describe("Unsafe Pickle Detection (Ruff + LLM)", () => {
  it("flags pickle.load/loads with untrusted data sources", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // load_user_upload, load_from_network, process_api_response
    expect(violations.length).toBe(3);

    const violationCode = violations.map((c) => c.matchedCode);
    // All violations should contain pickle usage
    expect(violationCode.every((c) => c.includes("pickle"))).toBe(true);
  });

  it("passes pickle.load from trusted sources (cache, tests)", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // load_cache (internal cache), load_test_fixture (test)
    expect(filtered.length).toBe(2);
  });

  it("Ruff stage alone finds ALL pickle usage", async () => {
    const pipeline = buildPipeline(rule, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);
    const allFindings = result.candidates.filter((c) => !c.filtered);

    // All 5 pickle.load/loads calls
    expect(allFindings.length).toBe(5);

    expect(result.trace.stages).toHaveLength(1);
    expect(result.trace.stages[0].name).toBe("ruff");
  });

  it("has correct 2-stage pipeline trace", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[0].name).toBe("ruff");
    expect(result.trace.stages[1].name).toBe("llm");

    expect(result.trace.stages[0].candidatesOut).toBe(5);
    expect(result.trace.stages[1].candidatesIn).toBe(5);
    expect(result.trace.stages[1].candidatesOut).toBe(3);
  });

  it("is configured as severity error (security issue)", async () => {
    expect(rule.severity).toBe("error");
  });
});

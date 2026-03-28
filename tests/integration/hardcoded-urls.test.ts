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
  join(__dirname, "../fixtures/code/hardcoded-urls.ts"),
  "utf-8",
);

const file: FileContext = {
  filePath: "hardcoded-urls.ts",
  content: fixture,
  language: "typescript",
};

/**
 * Hardcoded Development/Staging URLs
 *
 * WHY DEEP-LINT IS BETTER:
 * - ESLint has no built-in rule for URL pattern detection
 * - A simple regex finds all localhost/staging URLs but can't distinguish
 *   test helpers from production code
 * - Semgrep can match URL patterns but can't reason about code context
 * - Deep-lint: regex stage finds dev/staging URLs fast, then LLM evaluates
 *   whether the URL is in test/config code (acceptable) or production code
 *   (violation). The regex pre-filters thousands of lines down to a handful
 *   of URL matches, making LLM analysis fast and cheap.
 */
const rule = parseRuleYaml(`
id: no-hardcoded-env-config
language: typescript
severity: warning
description: "No hardcoded development/staging URLs in production code"
pipeline:
  - regex:
      pattern: "https?://(localhost|127\\\\.0\\\\.0\\\\.1|[^\\"'\\\\s]*\\\\.(dev|staging|local)\\\\b)[^\\"'\\\\s]*"
  - llm:
      prompt: |
        This code contains a hardcoded development/staging URL.

        Matched URL: $MATCHED_CODE
        File: $FILE_PATH

        Is this URL in test code, documentation, or regex patterns (acceptable)?
        Or is it in production code paths (violation)?
      confidence_threshold: 0.7
`);

// Mock LLM: in reality, the LLM would analyze the full code context around each URL.
// For testing, we simulate by checking if the URL is the test server URL (port 4000)
// or if it appears in a comment/regex context based on the matched text itself.
const model = createMockModelFromFn((prompt) => {
  const codeMatch = prompt.match(/Matched URL:\s*(.*)/);
  const url = codeMatch?.[1]?.trim() ?? "";

  // Test server on port 4000 is safe (used in createTestServer helper)
  const isTestUrl = url.includes(":4000");
  // Documentation example URL
  const isDocUrl = url.includes(":8080/health");

  const isSafe = isTestUrl || isDocUrl;

  return {
    isViolation: !isSafe,
    confidence: 0.9,
    reasoning: isSafe
      ? "URL is in test/documentation context — acceptable"
      : `Hardcoded dev URL found: ${url} — should use environment variable`,
  };
});

describe("Hardcoded URL Detection (regex + LLM)", () => {
  it("flags hardcoded localhost and staging URLs in production code", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // API_URL (localhost:3000), STAGING_ENDPOINT (staging), DEV_SERVER (dev),
    // METRICS_URL (127.0.0.1), fetchUserData (localhost:5000), DB_URL (localhost:5432)
    expect(violations.length).toBeGreaterThanOrEqual(5);

    const urls = violations.map((c) => c.matchedCode);
    expect(urls.some((u) => u.includes("localhost:3000"))).toBe(true);
    expect(urls.some((u) => u.includes("staging.example.com"))).toBe(true);
    expect(urls.some((u) => u.includes("127.0.0.1"))).toBe(true);
  });

  it("regex stage alone finds all dev URLs before LLM filtering", async () => {
    const pipeline = buildPipeline(rule, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);
    const allMatches = result.candidates.filter((c) => !c.filtered);

    // Should find all localhost/staging/dev URLs including ones in test helpers
    expect(allMatches.length).toBeGreaterThanOrEqual(6);

    expect(result.trace.stages).toHaveLength(1);
    expect(result.trace.stages[0].name).toBe("regex");
  });

  it("has correct 2-stage pipeline trace", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[0].name).toBe("regex");
    expect(result.trace.stages[1].name).toBe("llm");

    // LLM stage should have fewer candidates out than in (some filtered as safe)
    expect(result.trace.stages[1].candidatesOut).toBeLessThan(
      result.trace.stages[1].candidatesIn,
    );
  });
});

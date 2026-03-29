import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRuleYaml,
  buildPipeline,
  executePipeline,
  type FileContext,
} from "../../src/index.js";
import { createMockModelFromFn } from "../fixtures/helpers/mock-llm.js";

// Mock runTool since Ruff may not be installed
vi.mock("../../src/stages/tool-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/stages/tool-runner.js")>();
  return {
    ...actual,
    runTool: vi.fn(),
  };
});

import { runTool } from "../../src/stages/tool-runner.js";
const mockedRunTool = vi.mocked(runTool);

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
        Code: $MATCHED_CODE
        File: $FILE_PATH
      confidence_threshold: 0.8
`);

// Mock LLM: check if the data source seems trusted
const model = createMockModelFromFn((prompt) => {
  const codeMatch = prompt.match(/Code:\s*([\s\S]+?)(?:\nFile:)/);
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

// Simulate Ruff finding pickle.load/loads calls
function setupRuffMock() {
  const lines = fixture.split("\n");
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Find pickle.load( and pickle.loads( — Ruff S301
    const loadMatch = line.match(/pickle\.loads?\(/);
    if (loadMatch && !line.includes("pickle.dump")) {
      // Get surrounding context for matchedCode
      const startLine = Math.max(0, i - 1);
      const endLine = Math.min(lines.length - 1, i + 1);
      const matchedCode = lines.slice(startLine, endLine + 1).join("\n");

      findings.push({
        location: {
          filePath: "pickle-usage.py",
          startLine: i + 1,
          startColumn: line.indexOf("pickle"),
          endLine: i + 1,
          endColumn: line.indexOf("pickle") + loadMatch[0].length + 1,
        },
        message: "Possible use of `pickle` with untrusted data",
        ruleId: "S301",
        matchedCode,
        annotations: { ruffCode: "S301" },
      });
    }
  }

  mockedRunTool.mockResolvedValue({ findings });
}

describe("Unsafe Pickle Detection (Ruff + LLM)", () => {
  beforeEach(() => {
    setupRuffMock();
  });

  it("flags pickle.load/loads with untrusted data sources", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // load_user_upload, load_from_network, process_api_response
    expect(violations.length).toBe(3);

    const violationCode = violations.map((c) => c.matchedCode);
    expect(violationCode.some((c) => c.includes("user_upload") || c.includes("file_path"))).toBe(true);
    expect(violationCode.some((c) => c.includes("data: bytes") || c.includes("network"))).toBe(true);
    expect(violationCode.some((c) => c.includes("response_body") || c.includes("api_response"))).toBe(true);
  });

  it("passes pickle.load from trusted sources (cache, tests)", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // load_cache (internal cache), load_test_fixture (test)
    expect(filtered.length).toBe(2);

    const filteredCode = filtered.map((c) => c.matchedCode);
    expect(filteredCode.some((c) => c.includes("cache"))).toBe(true);
    expect(filteredCode.some((c) => c.includes("test") || c.includes("fixture"))).toBe(true);
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

import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { scan } from "../../src/cli/scan.js";
import { FsCacheStore } from "../../src/cache/fs-cache-store.js";
import { createMockModel } from "../fixtures/helpers/mock-llm.js";

const fixturesDir = join(__dirname, "../fixtures");
const rulesDir = join(fixturesDir, "rules");
const codePath = join(fixturesDir, "scan-code");

describe("scan", () => {
  it("finds violations with simple pattern rule (no LLM)", async () => {
    const result = await scan({
      paths: [codePath],
      rulesDir,
      format: "json",
      skipLlm: true,
    });

    const findings = JSON.parse(result.output);
    expect(findings.length).toBeGreaterThan(0);

    // Should find console.log calls
    const consoleLogs = findings.filter(
      (f: any) => f.ruleId === "no-console-log",
    );
    expect(consoleLogs.length).toBe(2);
  });

  it("outputs pretty format", async () => {
    const result = await scan({
      paths: [codePath],
      rulesDir,
      format: "pretty",
      skipLlm: true,
    });

    expect(result.output).toContain("no-console-log");
    expect(result.output).toContain("warning");
  });

  it("runs multi-stage with mock LLM", async () => {
    const model = createMockModel({
      isViolation: true,
      confidence: 0.85,
      reasoning: "No error handling found",
    });

    const result = await scan({
      paths: [codePath],
      rulesDir,
      format: "json",
      model,
    });

    const findings = JSON.parse(result.output);
    // Should have both console.log findings and error handling findings
    expect(findings.length).toBeGreaterThan(0);
  });

  it("returns hasErrors=false for warnings", async () => {
    const result = await scan({
      paths: [codePath],
      rulesDir,
      format: "json",
      skipLlm: true,
    });

    expect(result.hasErrors).toBe(false);
  });

  it("handles no matching files gracefully", async () => {
    const result = await scan({
      paths: ["/tmp"],
      rulesDir,
      format: "json",
      skipLlm: true,
    });

    const findings = JSON.parse(result.output);
    expect(findings).toEqual([]);
  });

  it("filters by severity", async () => {
    const result = await scan({
      paths: [codePath],
      rulesDir,
      format: "json",
      skipLlm: true,
      severity: "error",
    });

    const findings = JSON.parse(result.output);
    // Our fixture rules are all warnings, so filtering by error should find nothing
    expect(findings).toEqual([]);
  });
});

describe("scan with caching", () => {
  const cacheDirs: string[] = [];

  function tmpCacheDir(): string {
    const dir = join(tmpdir(), `deep-lint-scan-test-${randomBytes(4).toString("hex")}`);
    cacheDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of cacheDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    cacheDirs.length = 0;
  });

  it("accepts cacheStore option and produces same results as without cache", async () => {
    const model = createMockModel({
      isViolation: true,
      confidence: 0.85,
      reasoning: "Violation found",
    });

    const cacheStore = new FsCacheStore({ cacheDir: tmpCacheDir() });

    // Without cache
    const resultNoCache = await scan({
      paths: [codePath],
      rulesDir,
      format: "json",
      model,
    });

    // With cache
    const resultWithCache = await scan({
      paths: [codePath],
      rulesDir,
      format: "json",
      model,
      modelId: "test-mock",
      cacheStore,
    });

    const findingsNoCache = JSON.parse(resultNoCache.output);
    const findingsWithCache = JSON.parse(resultWithCache.output);

    // Same number of findings
    expect(findingsWithCache.length).toBe(findingsNoCache.length);
  });

  it("second scan with cache produces same output as first", async () => {
    const model = createMockModel({
      isViolation: true,
      confidence: 0.85,
      reasoning: "Violation found",
    });

    const cacheStore = new FsCacheStore({ cacheDir: tmpCacheDir() });

    const result1 = await scan({
      paths: [codePath],
      rulesDir,
      format: "json",
      model,
      modelId: "test-mock",
      cacheStore,
    });

    const result2 = await scan({
      paths: [codePath],
      rulesDir,
      format: "json",
      model,
      modelId: "test-mock",
      cacheStore,
    });

    const findings1 = JSON.parse(result1.output);
    const findings2 = JSON.parse(result2.output);
    expect(findings1.length).toBe(findings2.length);
    expect(result1.hasErrors).toBe(result2.hasErrors);
  });

  it("works without LLM stages when cache is enabled", async () => {
    const cacheStore = new FsCacheStore({ cacheDir: tmpCacheDir() });

    const result = await scan({
      paths: [codePath],
      rulesDir,
      format: "json",
      skipLlm: true,
      cacheStore,
    });

    const findings = JSON.parse(result.output);
    expect(findings.length).toBeGreaterThan(0);
  });
});

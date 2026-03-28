import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scan } from "../../src/cli/scan.js";
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

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  parseRuleYaml,
  buildPipeline,
  executePipeline,
  discoverFiles,
} from "../../src/index.js";
import { createMockModel, createMockModelFromFn } from "../fixtures/helpers/mock-llm.js";

const fixturesDir = join(__dirname, "../fixtures");
const codePath = join(fixturesDir, "code");

describe("end-to-end: single-stage ast-grep pipeline", () => {
  it("finds console.log violations in example.ts but not example-clean.ts", async () => {
    const rule = parseRuleYaml(`
id: no-console-log
language: typescript
severity: warning
description: "No console.log"
pipeline:
  - ast-grep:
      pattern: "console.log($$$ARGS)"
`);

    const pipeline = buildPipeline(rule, { skipLlm: true });
    const files = discoverFiles({ paths: [codePath], language: "typescript" });
    const result = await executePipeline(pipeline, files);

    const active = result.candidates.filter((c) => !c.filtered);

    // example.ts has 2 console.log calls, example-clean.ts has 0
    const fromExample = active.filter((c) =>
      c.fileContext.filePath.endsWith("example.ts"),
    );
    const fromClean = active.filter((c) =>
      c.fileContext.filePath.endsWith("example-clean.ts"),
    );

    expect(fromExample.length).toBe(2);
    expect(fromClean.length).toBe(0);

    // Verify trace
    expect(result.trace.stages).toHaveLength(1);
    expect(result.trace.stages[0].name).toBe("ast-grep");
  });

  it("finds 'as any' casts", async () => {
    const rule = parseRuleYaml(`
id: no-any-cast
language: typescript
severity: warning
description: "No any casts"
pipeline:
  - ast-grep:
      pattern: "$EXPR as any"
`);

    const pipeline = buildPipeline(rule);
    const files = discoverFiles({ paths: [codePath], language: "typescript" });
    const result = await executePipeline(pipeline, files);

    const active = result.candidates.filter((c) => !c.filtered);
    // example.ts has "items as unknown[]" which is NOT "as any"
    // Let's check — there shouldn't be any "as any" matches
    // Actually example.ts has "any[]" in type annotation, not "as any" cast
    // So we expect 0 findings since the fixture doesn't use "as any"
    expect(active.length).toBe(0);
  });
});

describe("end-to-end: multi-stage ast-grep + LLM pipeline", () => {
  it("uses LLM to filter async functions with error handling", async () => {
    const rule = parseRuleYaml(`
id: ensure-error-handling
language: typescript
severity: warning
description: "Async functions should have error handling"
pipeline:
  - ast-grep:
      pattern: "async function $FUNC($$$PARAMS) { $$$BODY }"
  - llm:
      prompt: |
        Does this async function have proper error handling?
        Function: $FUNC
        Code:
        $MATCHED_CODE
      confidence_threshold: 0.7
`);

    // Mock LLM that checks if "try" or "catch" appears in the matched code
    const model = createMockModelFromFn((prompt) => {
      const hasTryCatch =
        prompt.includes("try") && prompt.includes("catch");
      return {
        isViolation: !hasTryCatch,
        confidence: 0.9,
        reasoning: hasTryCatch
          ? "Has try/catch error handling"
          : "No error handling found",
      };
    });

    const pipeline = buildPipeline(rule, { model });
    const files = discoverFiles({ paths: [codePath], language: "typescript" });
    const result = await executePipeline(pipeline, files);

    const active = result.candidates.filter((c) => !c.filtered);

    // example.ts has loadUser (no try/catch) -> violation
    // example-clean.ts has loadUser (with try/catch) -> filtered out by LLM
    const violations = active.filter(
      (c) => c.metaVariables.FUNC === "loadUser",
    );

    // Only the one without error handling should remain
    expect(violations.length).toBe(1);
    expect(violations[0].fileContext.filePath).toContain("example.ts");
    expect(violations[0].fileContext.filePath).not.toContain("example-clean.ts");
    expect(violations[0].annotations.llmConfidence).toBe(0.9);

    // Verify trace shows 2 stages
    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[0].name).toBe("ast-grep");
    expect(result.trace.stages[1].name).toBe("llm");
  });

  it("skips LLM stage with skipLlm option", async () => {
    const rule = parseRuleYaml(`
id: ensure-error-handling
language: typescript
severity: warning
description: "Test"
pipeline:
  - ast-grep:
      pattern: "async function $FUNC($$$PARAMS) { $$$BODY }"
  - llm:
      prompt: "test"
      confidence_threshold: 0.7
`);

    const pipeline = buildPipeline(rule, { skipLlm: true });
    const files = discoverFiles({ paths: [codePath], language: "typescript" });
    const result = await executePipeline(pipeline, files);

    // Without LLM filtering, both loadUser functions should be found
    const active = result.candidates.filter((c) => !c.filtered);
    const loadUsers = active.filter((c) => c.metaVariables.FUNC === "loadUser");
    expect(loadUsers.length).toBe(2); // one from each file

    // Only 1 stage in trace
    expect(result.trace.stages).toHaveLength(1);
    expect(result.trace.stages[0].name).toBe("ast-grep");
  });
});

describe("end-to-end: programmatic API usage", () => {
  it("can be used as a library with inline rule and files", async () => {
    const rule = parseRuleYaml(`
id: inline-test
language: typescript
severity: info
description: "Find fetch calls"
pipeline:
  - ast-grep:
      pattern: "fetch($URL)"
`);

    const pipeline = buildPipeline(rule);
    const files = [
      {
        filePath: "virtual.ts",
        content: 'const res = await fetch("/api/data");',
        language: "typescript" as const,
      },
    ];

    const result = await executePipeline(pipeline, files);
    const active = result.candidates.filter((c) => !c.filtered);

    expect(active.length).toBe(1);
    expect(active[0].metaVariables.URL).toBe('"/api/data"');
    expect(active[0].location.filePath).toBe("virtual.ts");
  });
});

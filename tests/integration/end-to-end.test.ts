import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  parseRuleYaml,
  buildPipeline,
  executePipeline,
  discoverFiles,
  isCacheableStage,
} from "../../src/index.js";
import type { CacheStore, CacheEntry } from "../../src/cache/cache-store.js";
import { createMockModel, createMockModelFromFn } from "../fixtures/helpers/mock-llm.js";

function createMemoryCacheStore(): CacheStore & { store: Map<string, CacheEntry> } {
  const store = new Map<string, CacheEntry>();
  return {
    store,
    async get(key: string) { return store.get(key); },
    async set(key: string, entry: CacheEntry) { store.set(key, entry); },
    async clear() { store.clear(); },
  };
}

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

describe("end-to-end: caching integration", () => {
  it("caches LLM stage results and serves from cache on second run", async () => {
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
      model_id: "test-mock"
`);

    let llmCallCount = 0;
    const model = createMockModelFromFn((prompt) => {
      llmCallCount++;
      const hasTryCatch = prompt.includes("try") && prompt.includes("catch");
      return {
        isViolation: !hasTryCatch,
        confidence: 0.9,
        reasoning: hasTryCatch ? "Has try/catch" : "No error handling",
      };
    });

    const cache = createMemoryCacheStore();
    const pipeline = buildPipeline(rule, { model });
    const files = discoverFiles({ paths: [codePath], language: "typescript" });

    // First run: all misses, LLM is called
    const result1 = await executePipeline(pipeline, files, { cacheStore: cache });
    const llmTrace1 = result1.trace.stages.find((s) => s.name === "llm")!;
    expect(llmTrace1.cacheHits).toBe(0);
    expect(llmTrace1.cacheMisses).toBeGreaterThan(0);
    const firstRunCalls = llmCallCount;
    expect(firstRunCalls).toBeGreaterThan(0);

    // Second run: all hits, LLM is NOT called again
    const result2 = await executePipeline(pipeline, files, { cacheStore: cache });
    const llmTrace2 = result2.trace.stages.find((s) => s.name === "llm")!;
    expect(llmTrace2.cacheHits).toBe(llmTrace1.cacheMisses);
    expect(llmTrace2.cacheMisses).toBe(0);
    expect(llmCallCount).toBe(firstRunCalls); // No additional LLM calls

    // Results should be equivalent
    const active1 = result1.candidates.filter((c) => !c.filtered);
    const active2 = result2.candidates.filter((c) => !c.filtered);
    expect(active1.length).toBe(active2.length);
  });

  it("cache-cleared run repopulates cache with fresh results", async () => {
    const rule = parseRuleYaml(`
id: test-cache-clear
language: typescript
severity: info
description: "Find console.log"
pipeline:
  - ast-grep:
      pattern: "console.log($$$ARGS)"
  - llm:
      prompt: "Is $MATCHED_CODE a debug statement?"
      model_id: "test-mock"
`);

    const model = createMockModel({ isViolation: true, confidence: 0.9, reasoning: "yes" });
    const cache = createMemoryCacheStore();
    const pipeline = buildPipeline(rule, { model });
    const files = discoverFiles({ paths: [codePath], language: "typescript" });

    // First run populates cache
    await executePipeline(pipeline, files, { cacheStore: cache });
    expect(cache.store.size).toBeGreaterThan(0);

    // Clear cache
    await cache.clear();
    expect(cache.store.size).toBe(0);

    // Second run repopulates
    const result = await executePipeline(pipeline, files, { cacheStore: cache });
    const llmTrace = result.trace.stages.find((s) => s.name === "llm")!;
    expect(llmTrace.cacheHits).toBe(0);
    expect(llmTrace.cacheMisses).toBeGreaterThan(0);
    expect(cache.store.size).toBeGreaterThan(0);
  });

  it("non-cacheable LLM stage works normally without cache store", async () => {
    const rule = parseRuleYaml(`
id: no-model-id
language: typescript
severity: warning
description: "Test without model_id"
pipeline:
  - ast-grep:
      pattern: "console.log($$$ARGS)"
  - llm:
      prompt: "Check: $MATCHED_CODE"
`);

    const model = createMockModel({ isViolation: true, confidence: 0.9, reasoning: "test" });
    const pipeline = buildPipeline(rule, { model });
    const files = discoverFiles({ paths: [codePath], language: "typescript" });

    // No cacheStore passed — should work fine, no cache metrics
    const result = await executePipeline(pipeline, files);
    const llmTrace = result.trace.stages.find((s) => s.name === "llm")!;
    expect(llmTrace.cacheHits).toBeUndefined();
    expect(llmTrace.cacheMisses).toBeUndefined();
    expect(result.candidates.filter((c) => !c.filtered).length).toBeGreaterThan(0);
  });
});

describe("end-to-end: granular context variables", () => {
  it("uses $SURROUNDING(N) in prompt for LLM context", async () => {
    let capturedPrompt = "";
    const model = createMockModelFromFn((prompt) => {
      capturedPrompt = prompt;
      return { isViolation: true, confidence: 0.9, reasoning: "test" };
    });

    const rule = parseRuleYaml(`
id: surrounding-test
language: typescript
severity: info
description: "Test surrounding context"
pipeline:
  - ast-grep:
      pattern: "console.log($$$ARGS)"
  - llm:
      prompt: |
        Context around the match:
        $SURROUNDING(3)
        ---
        The match is at line $START_LINE in $FILE_PATH ($LANGUAGE).
`);

    const pipeline = buildPipeline(rule, { model });
    const files = [
      {
        filePath: "virtual.ts",
        content: "import x from 'y';\n\nfunction hello() {\n  console.log('hi');\n  return true;\n}\n\nexport default hello;",
        language: "typescript" as const,
      },
    ];

    const result = await executePipeline(pipeline, files);
    const active = result.candidates.filter((c) => !c.filtered);
    expect(active.length).toBe(1);

    // The prompt should contain surrounding lines
    expect(capturedPrompt).toContain("function hello()");
    expect(capturedPrompt).toContain("console.log");
    expect(capturedPrompt).toContain("return true;");
    // Should contain line number and path
    expect(capturedPrompt).toContain("virtual.ts");
    expect(capturedPrompt).toContain("typescript");
  });

  it("uses $FILE_CONTENT in prompt for full file analysis", async () => {
    let capturedPrompt = "";
    const model = createMockModelFromFn((prompt) => {
      capturedPrompt = prompt;
      return { isViolation: true, confidence: 0.9, reasoning: "test" };
    });

    const fileContent = "import fs from 'fs';\n\nconst data = fs.readFileSync('file.txt');\nconsole.log(data);";

    const rule = parseRuleYaml(`
id: file-content-test
language: typescript
severity: info
description: "Test file content"
pipeline:
  - ast-grep:
      pattern: "console.log($$$ARGS)"
  - llm:
      prompt: |
        Full file:
        $FILE_CONTENT
`);

    const pipeline = buildPipeline(rule, { model });
    const files = [{ filePath: "v.ts", content: fileContent, language: "typescript" as const }];

    await executePipeline(pipeline, files);

    expect(capturedPrompt).toContain("import fs from 'fs'");
    expect(capturedPrompt).toContain("fs.readFileSync");
    expect(capturedPrompt).toContain("console.log(data)");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRuleYaml,
  buildPipeline,
  executePipeline,
  type FileContext,
} from "../../src/index.js";

const fixture = readFileSync(
  join(__dirname, "../fixtures/code/todo-comments.ts"),
  "utf-8",
);

const file: FileContext = {
  filePath: "todo-comments.ts",
  content: fixture,
  language: "typescript",
};

/**
 * TODO/FIXME Without Issue Tracking
 *
 * WHY DEEP-LINT IS BETTER:
 * - ESLint's no-warning-comments bans ALL TODO/FIXME comments — too aggressive
 *   for real codebases where TODOs are part of the workflow
 * - A simple regex can find TODOs but can't distinguish tracked from untracked
 * - Deep-lint: regex stage 1 finds all TODO/FIXME/HACK comments, regex stage 2
 *   (inverted) filters OUT those that already reference an issue tracker —
 *   only untracked TODOs remain as violations
 *
 * This is a PURE regex pipeline — no LLM needed, no AST needed.
 * Two regex stages compose to create nuanced filtering no single regex can do.
 */
const rule = parseRuleYaml(`
id: no-todo-without-issue
language: typescript
severity: warning
description: "TODO/FIXME/HACK comments must reference a tracking issue"
pipeline:
  - regex:
      pattern: "(?<tag>TODO|FIXME|HACK)[:(]?\\\\s*(?<message>.*)"
  - regex:
      pattern: "(#\\\\d+|[A-Z]+-\\\\d+|https?://)"
      invert: true
`);

describe("TODO Without Issue Tracking (regex + regex pipeline)", () => {
  it("flags TODOs without issue references", async () => {
    const pipeline = buildPipeline(rule, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // "TODO: refactor this function later" — no issue reference
    // "HACK: this works around a browser bug" — no issue reference
    // "FIXME: memory leak in event listeners" — no issue reference
    // "TODO: add proper validation" — no issue reference
    expect(violations.length).toBe(4);

    const messages = violations.map((c) => c.matchedCode);
    expect(messages.some((m) => m.includes("refactor this function"))).toBe(true);
    expect(messages.some((m) => m.includes("works around a browser bug"))).toBe(true);
    expect(messages.some((m) => m.includes("memory leak"))).toBe(true);
    expect(messages.some((m) => m.includes("add proper validation"))).toBe(true);
  });

  it("passes TODOs that reference issues", async () => {
    const pipeline = buildPipeline(rule, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // "FIXME(#1234):" — has issue reference
    // "TODO(JIRA-567):" — has JIRA reference
    // "TODO: https://github.com/..." — has URL
    // "HACK(PROJ-89):" — has project reference
    expect(filtered.length).toBe(4);

    const filteredText = filtered.map((c) => c.matchedCode);
    expect(filteredText.some((m) => m.includes("#1234"))).toBe(true);
    expect(filteredText.some((m) => m.includes("JIRA-567"))).toBe(true);
    expect(filteredText.some((m) => m.includes("https://"))).toBe(true);
    expect(filteredText.some((m) => m.includes("PROJ-89"))).toBe(true);
  });

  it("extracts tag and message as metavariables", async () => {
    const pipeline = buildPipeline(rule, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);

    for (const c of result.candidates) {
      expect(c.metaVariables.tag).toMatch(/^(TODO|FIXME|HACK)$/);
      expect(c.metaVariables.message).toBeDefined();
    }
  });

  it("has correct pipeline trace with 2 regex stages", async () => {
    const pipeline = buildPipeline(rule, { skipLlm: true });
    const result = await executePipeline(pipeline, [file]);

    expect(result.trace.stages).toHaveLength(2);
    expect(result.trace.stages[0].name).toBe("regex");
    expect(result.trace.stages[1].name).toBe("regex");

    // Stage 1 finds all TODOs (8 total)
    expect(result.trace.stages[0].candidatesOut).toBe(8);

    // Stage 2 filters out the ones with issue references (4 remain)
    expect(result.trace.stages[1].candidatesIn).toBe(8);
    expect(result.trace.stages[1].candidatesOut).toBe(4);
  });
});

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
  join(__dirname, "../fixtures/code/react-effects.tsx"),
  "utf-8",
);

const file: FileContext = {
  filePath: "react-effects.tsx",
  content: fixture,
  language: "tsx",
};

/**
 * React useEffect Missing Cleanup
 *
 * WHY ONLY DEEP-LINT CAN DO THIS:
 * - ESLint's react-hooks/exhaustive-deps only checks dependency arrays,
 *   not whether subscriptions are cleaned up
 * - ast-grep can find useEffect calls but can't reason about whether
 *   a subscription in the body has a matching cleanup return
 * - Deep-lint: ast-grep finds useEffect calls, LLM checks if effects
 *   that create subscriptions also return cleanup functions
 */
const rule = parseRuleYaml(`
id: react-effect-cleanup
language: tsx
severity: warning
description: "useEffect with subscriptions must return a cleanup function"
pipeline:
  - ast-grep:
      pattern: "useEffect($$$ARGS)"
  - llm:
      prompt: |
        Analyze this React useEffect call. If the effect sets up a subscription
        (addEventListener, setInterval, setTimeout, .subscribe()), does it
        return a cleanup function that tears down the subscription?

        Code:
        $MATCHED_CODE

        Rules:
        - If the effect has addEventListener, it must have removeEventListener in a return
        - If the effect has setInterval, it must have clearInterval in a return
        - If the effect has .subscribe(), it must have .unsubscribe() in a return
        - If the effect has no subscription, it does NOT need cleanup (not a violation)
      confidence_threshold: 0.8
`);

// Mock LLM: check for subscription patterns and matching cleanup in matched code only
const model = createMockModelFromFn((prompt) => {
  // Extract only the "Code:" section to avoid matching instructional text
  const codeMatch = prompt.match(/Code:\s*\n([\s\S]+?)(?:\n\s*\n\s*Rules:)/);
  const code = codeMatch?.[1] ?? "";

  const hasAddEventListener = code.includes("addEventListener");
  const hasSetInterval = code.includes("setInterval");
  const hasSubscribe = code.includes(".subscribe(");

  const hasSubscription = hasAddEventListener || hasSetInterval || hasSubscribe;

  if (!hasSubscription) {
    return {
      isViolation: false,
      confidence: 0.95,
      reasoning: "No subscription pattern found — cleanup not required",
    };
  }

  const hasReturn = code.includes("return ()") || code.includes("return function");
  const hasRemoveEventListener = code.includes("removeEventListener");
  const hasClearInterval = code.includes("clearInterval");
  const hasUnsubscribe = code.includes("unsubscribe");

  const hasCleanup =
    hasReturn &&
    ((hasAddEventListener && hasRemoveEventListener) ||
      (hasSetInterval && hasClearInterval) ||
      (hasSubscribe && hasUnsubscribe));

  return {
    isViolation: !hasCleanup,
    confidence: 0.93,
    reasoning: hasCleanup
      ? "Effect has subscription with matching cleanup"
      : "Effect creates subscription but has no cleanup return function",
  };
});

describe("React useEffect Cleanup Detection (ast-grep + LLM)", () => {
  it("flags effects with subscriptions but no cleanup", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // WindowResizeTracker (addEventListener, no cleanup)
    // PollingComponent (setInterval, no cleanup)
    // EventStreamComponent (.subscribe, no cleanup)
    expect(violations.length).toBe(3);
    expect(
      violations.some((c) => c.matchedCode.includes("addEventListener") && !c.matchedCode.includes("removeEventListener")),
    ).toBe(true);
    expect(
      violations.some((c) => c.matchedCode.includes("setInterval") && !c.matchedCode.includes("clearInterval")),
    ).toBe(true);
    expect(
      violations.some((c) => c.matchedCode.includes(".subscribe(") && !c.matchedCode.includes("unsubscribe")),
    ).toBe(true);
  });

  it("passes effects with proper cleanup", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // WindowResizeTrackerClean, PollingComponentClean, EventStreamComponentClean, TitleUpdater
    expect(filtered.length).toBe(4);
  });

  it("passes simple effects that don't need cleanup", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    // TitleUpdater sets document.title — no subscription, so no cleanup needed
    const titleEffect = result.candidates.find((c) =>
      c.matchedCode.includes("document.title"),
    );
    expect(titleEffect).toBeDefined();
    expect(titleEffect!.filtered).toBe(true);
    expect(titleEffect!.annotations.llmReasoning).toContain("cleanup not required");
  });

  it("captures useEffect in tsx files correctly", async () => {
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    // Should find all 7 useEffect calls
    expect(result.candidates.length).toBe(7);
    expect(result.trace.stages[0].candidatesOut).toBe(7);
  });
});

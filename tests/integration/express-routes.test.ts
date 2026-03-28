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
  join(__dirname, "../fixtures/code/express-routes.ts"),
  "utf-8",
);

const file: FileContext = {
  filePath: "express-routes.ts",
  content: fixture,
  language: "typescript",
};

/**
 * Express Routes Without Auth Middleware
 *
 * WHY ONLY DEEP-LINT CAN DO THIS:
 * - ast-grep can find app.get/post/delete calls but can't tell if
 *   auth middleware is included in the handler chain
 * - ESLint has no awareness of Express routing patterns
 * - Deep-lint: ast-grep finds route definitions, LLM checks whether
 *   the route includes auth middleware or is a public endpoint
 */

function makeRule(method: string) {
  return parseRuleYaml(`
id: no-unprotected-${method}
language: typescript
severity: warning
description: "API routes should have authentication middleware"
pipeline:
  - ast-grep:
      pattern: "app.${method}($PATH, $$$HANDLERS)"
  - llm:
      prompt: |
        Does this Express route have authentication middleware?

        Route: app.${method}($PATH, ...)
        Path: $PATH
        Full code: $MATCHED_CODE

        Rules:
        - If handlers include authMiddleware, requireAuth, isAuthenticated,
          requireAdmin, or similar auth functions, it is protected (NOT a violation)
        - Public endpoints like /health, /login, /register, /public do NOT
          need auth (NOT a violation)
        - API endpoints under /api/ that handle user data without auth ARE violations
      confidence_threshold: 0.7
`);
}

// Mock LLM: check for auth middleware or public path in matched code only
const model = createMockModelFromFn((prompt) => {
  // Extract only the "Full code:" section to avoid matching instructional text
  const codeMatch = prompt.match(/Full code:\s*([\s\S]+?)(?:\n\s*\n|\s*Rules:)/);
  const code = codeMatch?.[1] ?? "";

  const authPatterns = ["authMiddleware", "requireAuth", "isAuthenticated", "requireAdmin"];
  const hasAuth = authPatterns.some((p) => code.includes(p));

  const publicPathPatterns = ["/health", "/login", "/register", "/public"];
  const isPublicPath = publicPathPatterns.some((p) => code.includes(p));

  const needsAuth = !hasAuth && !isPublicPath;

  return {
    isViolation: needsAuth,
    confidence: 0.9,
    reasoning: hasAuth
      ? "Route is protected with auth middleware"
      : isPublicPath
        ? "Route is a public endpoint that doesn't require auth"
        : "API route has no auth middleware — potential security issue",
  };
});

describe("Express Route Auth Detection (ast-grep + LLM)", () => {
  it("flags GET routes without auth", async () => {
    const rule = makeRule("get");
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // /api/users has no auth
    expect(violations.length).toBe(1);
    expect(violations[0].matchedCode).toContain("/api/users");
  });

  it("passes GET routes with auth or public paths", async () => {
    const rule = makeRule("get");
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // /health (public) and /api/profile (has authMiddleware)
    expect(filtered.length).toBe(2);
    expect(filtered.some((c) => c.matchedCode.includes("/health"))).toBe(true);
    expect(filtered.some((c) => c.matchedCode.includes("/api/profile"))).toBe(true);
  });

  it("flags POST routes without auth (non-public)", async () => {
    const rule = makeRule("post");
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // /api/admin/settings has no auth
    expect(violations.length).toBe(1);
    expect(violations[0].matchedCode).toContain("/api/admin/settings");
  });

  it("passes public POST routes (login, register)", async () => {
    const rule = makeRule("post");
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const filtered = result.candidates.filter((c) => c.filtered);

    // /api/login, /api/register (public), /api/admin/users (has auth)
    expect(filtered.length).toBe(3);
    expect(filtered.some((c) => c.matchedCode.includes("/api/login"))).toBe(true);
    expect(filtered.some((c) => c.matchedCode.includes("/api/register"))).toBe(true);
    expect(filtered.some((c) => c.matchedCode.includes("requireAdmin"))).toBe(true);
  });

  it("flags DELETE routes without auth", async () => {
    const rule = makeRule("delete");
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);
    const violations = result.candidates.filter((c) => !c.filtered);

    // app.delete /api/users/:id has no auth
    expect(violations.length).toBe(1);
    expect(violations[0].matchedCode).toContain("/api/users/:id");
  });

  it("reports correct metavariables for routes", async () => {
    const rule = makeRule("get");
    const pipeline = buildPipeline(rule, { model });
    const result = await executePipeline(pipeline, [file]);

    for (const c of result.candidates) {
      expect(c.metaVariables.PATH).toBeDefined();
      expect(c.metaVariables.PATH).toMatch(/^\"/);
    }
  });
});

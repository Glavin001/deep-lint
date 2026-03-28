import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseRuleYaml, loadRuleFromFile, buildPipeline } from "../../src/loader/rule-loader.js";
import { createMockModel } from "../fixtures/helpers/mock-llm.js";

const fixturesDir = join(__dirname, "../fixtures/rules");

describe("parseRuleYaml", () => {
  it("parses a simple rule", () => {
    const yaml = `
id: test-rule
language: typescript
severity: warning
description: "Test rule"
pipeline:
  - ast-grep:
      pattern: "console.log($$$ARGS)"
`;
    const rule = parseRuleYaml(yaml);
    expect(rule.id).toBe("test-rule");
    expect(rule.language).toBe("typescript");
    expect(rule.severity).toBe("warning");
    expect(rule.description).toBe("Test rule");
    expect(rule.pipeline).toHaveLength(1);
    expect(rule.pipeline[0].type).toBe("ast-grep");
    expect(rule.pipeline[0].config.pattern).toBe("console.log($$$ARGS)");
  });

  it("parses a multi-stage rule", () => {
    const yaml = `
id: multi-stage
language: typescript
severity: error
description: "Multi-stage rule"
pipeline:
  - ast-grep:
      pattern: "db.query($INPUT)"
  - llm:
      prompt: "Is $INPUT safe?"
      confidence_threshold: 0.8
`;
    const rule = parseRuleYaml(yaml);
    expect(rule.pipeline).toHaveLength(2);
    expect(rule.pipeline[0].type).toBe("ast-grep");
    expect(rule.pipeline[1].type).toBe("llm");
    expect(rule.pipeline[1].config.confidence_threshold).toBe(0.8);
  });

  it("rejects missing id", () => {
    const yaml = `
language: typescript
severity: warning
description: "No id"
pipeline:
  - ast-grep:
      pattern: "x"
`;
    expect(() => parseRuleYaml(yaml)).toThrow("'id'");
  });

  it("rejects invalid language", () => {
    const yaml = `
id: test
language: ruby
severity: warning
description: "Bad language"
pipeline:
  - ast-grep:
      pattern: "x"
`;
    expect(() => parseRuleYaml(yaml)).toThrow("language");
  });

  it("rejects invalid severity", () => {
    const yaml = `
id: test
language: typescript
severity: critical
description: "Bad severity"
pipeline:
  - ast-grep:
      pattern: "x"
`;
    expect(() => parseRuleYaml(yaml)).toThrow("severity");
  });

  it("rejects empty pipeline", () => {
    const yaml = `
id: test
language: typescript
severity: warning
description: "Empty pipeline"
pipeline: []
`;
    expect(() => parseRuleYaml(yaml)).toThrow("non-empty");
  });

  it("rejects invalid YAML", () => {
    expect(() => parseRuleYaml("not: [valid: yaml: here")).toThrow();
  });
});

describe("loadRuleFromFile", () => {
  it("loads a simple rule from file", () => {
    const rule = loadRuleFromFile(join(fixturesDir, "simple-pattern.yaml"));
    expect(rule.id).toBe("no-console-log");
    expect(rule.pipeline).toHaveLength(1);
  });

  it("loads a multi-stage rule from file", () => {
    const rule = loadRuleFromFile(join(fixturesDir, "multi-stage.yaml"));
    expect(rule.id).toBe("ensure-error-handling");
    expect(rule.pipeline).toHaveLength(2);
  });
});

describe("buildPipeline", () => {
  it("builds a pipeline from a simple rule", () => {
    const rule = loadRuleFromFile(join(fixturesDir, "simple-pattern.yaml"));
    const pipeline = buildPipeline(rule);

    expect(pipeline.ruleId).toBe("no-console-log");
    expect(pipeline.severity).toBe("warning");
    expect(pipeline.stages).toHaveLength(1);
    expect(pipeline.stages[0].name).toBe("ast-grep");
  });

  it("builds a pipeline with LLM stage when model is provided", () => {
    const rule = loadRuleFromFile(join(fixturesDir, "multi-stage.yaml"));
    const model = createMockModel({
      isViolation: true,
      confidence: 0.9,
      reasoning: "test",
    });
    const pipeline = buildPipeline(rule, { model });

    expect(pipeline.stages).toHaveLength(2);
    expect(pipeline.stages[0].name).toBe("ast-grep");
    expect(pipeline.stages[1].name).toBe("llm");
  });

  it("skips LLM stages when skipLlm is true", () => {
    const rule = loadRuleFromFile(join(fixturesDir, "multi-stage.yaml"));
    const pipeline = buildPipeline(rule, { skipLlm: true });

    expect(pipeline.stages).toHaveLength(1);
    expect(pipeline.stages[0].name).toBe("ast-grep");
  });

  it("throws when LLM stage has no model", () => {
    const rule = loadRuleFromFile(join(fixturesDir, "multi-stage.yaml"));
    expect(() => buildPipeline(rule)).toThrow("model");
  });

  it("throws for unknown stage type", () => {
    const rule = parseRuleYaml(`
id: test
language: typescript
severity: warning
description: "Unknown stage"
pipeline:
  - unknown-stage:
      key: value
`);
    expect(() => buildPipeline(rule)).toThrow("Unknown stage type");
  });
});

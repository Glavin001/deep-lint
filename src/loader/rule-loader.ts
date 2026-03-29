import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { RuleDefinition, StageDefinition } from "../core/rule.js";
import type { PipelineConfig } from "../core/pipeline.js";
import type { Stage } from "../core/stage.js";
import { StageRegistry, type StageRegistryOptions } from "../stages/index.js";
import type { Language, Severity } from "../types.js";

const VALID_SEVERITIES = new Set<string>(["error", "warning", "info"]);
const VALID_LANGUAGES = new Set<string>([
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "html",
  "css",
  "python",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
]);

export function parseRuleYaml(content: string): RuleDefinition {
  const raw = parseYaml(content);

  if (!raw || typeof raw !== "object") {
    throw new Error("Rule YAML must be an object");
  }

  if (!raw.id || typeof raw.id !== "string") {
    throw new Error("Rule must have a string 'id' field");
  }

  if (!raw.language || !VALID_LANGUAGES.has(raw.language)) {
    throw new Error(
      `Rule must have a valid 'language' field. Got: "${raw.language}". Valid: ${[...VALID_LANGUAGES].join(", ")}`,
    );
  }

  if (!raw.severity || !VALID_SEVERITIES.has(raw.severity)) {
    throw new Error(
      `Rule must have a valid 'severity' field. Got: "${raw.severity}". Valid: ${[...VALID_SEVERITIES].join(", ")}`,
    );
  }

  if (!raw.description || typeof raw.description !== "string") {
    throw new Error("Rule must have a string 'description' field");
  }

  if (!Array.isArray(raw.pipeline) || raw.pipeline.length === 0) {
    throw new Error("Rule must have a non-empty 'pipeline' array");
  }

  const pipeline: StageDefinition[] = raw.pipeline.map(
    (entry: unknown, index: number) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`Pipeline stage ${index} must be an object`);
      }

      const keys = Object.keys(entry as Record<string, unknown>);
      if (keys.length !== 1) {
        throw new Error(
          `Pipeline stage ${index} must have exactly one key (the stage type). Got: ${keys.join(", ")}`,
        );
      }

      const type = keys[0];
      const config = (entry as Record<string, unknown>)[type];

      if (!config || typeof config !== "object") {
        throw new Error(`Pipeline stage ${index} ("${type}") config must be an object`);
      }

      return {
        type,
        config: config as Record<string, unknown>,
      };
    },
  );

  return {
    id: raw.id,
    language: raw.language as Language,
    severity: raw.severity as Severity,
    description: raw.description,
    pipeline,
  };
}

export function loadRuleFromFile(filePath: string): RuleDefinition {
  const content = readFileSync(filePath, "utf-8");
  return parseRuleYaml(content);
}

export interface BuildPipelineOptions extends StageRegistryOptions {
  skipLlm?: boolean;
}

export function buildPipeline(
  rule: RuleDefinition,
  options: BuildPipelineOptions = {},
): PipelineConfig {
  const registry = new StageRegistry(options);

  const stages: Stage[] = [];
  for (const stageDef of rule.pipeline) {
    if (options.skipLlm && stageDef.type === "llm") {
      continue;
    }
    stages.push(registry.create(stageDef.type, stageDef.config));
  }

  if (stages.length === 0) {
    throw new Error(
      `Rule "${rule.id}" has no stages after filtering (did you skip all stages with --no-llm?)`,
    );
  }

  return {
    ruleId: rule.id,
    severity: rule.severity,
    description: rule.description,
    language: rule.language,
    stages,
  };
}

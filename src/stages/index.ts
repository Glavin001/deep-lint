import type { Stage, StageFactory } from "../core/stage.js";
import type { LanguageModel } from "ai";
import { createAstGrepStage } from "./ast-grep.js";
import { createLlmStage } from "./llm.js";
import { createRegexStage } from "./regex.js";
import { createEslintStage } from "./eslint.js";
import { createSemgrepStage } from "./semgrep.js";
import { createRuffStage } from "./ruff.js";

export interface StageRegistryOptions {
  model?: LanguageModel;
}

const builtinFactories: Record<string, (config: Record<string, unknown>, options: StageRegistryOptions) => Stage> = {
  "ast-grep": (config) =>
    createAstGrepStage({
      pattern: config.pattern as string,
      language: config.language as any,
    }),
  llm: (config, options) => {
    if (!options.model) {
      throw new Error(
        "LLM stage requires a model. Provide a model via options or use --no-llm to skip LLM stages.",
      );
    }
    return createLlmStage({
      prompt: config.prompt as string,
      model: options.model,
      confidenceThreshold: config.confidence_threshold as number | undefined,
    });
  },
  regex: (config) =>
    createRegexStage({
      pattern: config.pattern as string,
      flags: config.flags as string | undefined,
      invert: config.invert as boolean | undefined,
    }),
  eslint: (config) =>
    createEslintStage({
      rules: config.rules as Record<string, unknown>,
    }),
  semgrep: (config) =>
    createSemgrepStage({
      pattern: config.pattern as string | undefined,
      language: config.language as string | undefined,
      rule: config.rule as string | undefined,
    }),
  ruff: (config) =>
    createRuffStage({
      select: config.select as string[],
    }),
};

export class StageRegistry {
  private factories: Map<string, (config: Record<string, unknown>, options: StageRegistryOptions) => Stage>;

  constructor(private options: StageRegistryOptions = {}) {
    this.factories = new Map(Object.entries(builtinFactories));
  }

  register(
    type: string,
    factory: (config: Record<string, unknown>, options: StageRegistryOptions) => Stage,
  ): void {
    this.factories.set(type, factory);
  }

  create(type: string, config: Record<string, unknown>): Stage {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(
        `Unknown stage type: "${type}". Available: ${[...this.factories.keys()].join(", ")}`,
      );
    }
    return factory(config, this.options);
  }

  has(type: string): boolean {
    return this.factories.has(type);
  }
}

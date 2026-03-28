// Core
export { executePipeline } from "./core/pipeline.js";
export type { PipelineConfig, PipelineResult, PipelineTrace, StageTraceEntry } from "./core/pipeline.js";
export { createCandidate } from "./core/candidate.js";
export type { Candidate, CreateCandidateOptions } from "./core/candidate.js";
export type { Stage, StageContext, StageFactory } from "./core/stage.js";
export type { RuleDefinition, StageDefinition } from "./core/rule.js";

// Types
export type { Severity, Language, FileContext, Location, LintResult } from "./types.js";

// Stages
export { createAstGrepStage } from "./stages/ast-grep.js";
export type { AstGrepStageConfig } from "./stages/ast-grep.js";
export { createLlmStage, interpolatePrompt } from "./stages/llm.js";
export type { LlmStageConfig } from "./stages/llm.js";
export { createRegexStage } from "./stages/regex.js";
export type { RegexStageConfig } from "./stages/regex.js";
export { createEslintStage } from "./stages/eslint.js";
export type { EslintStageConfig } from "./stages/eslint.js";
export { createSemgrepStage } from "./stages/semgrep.js";
export type { SemgrepStageConfig } from "./stages/semgrep.js";
export { createRuffStage } from "./stages/ruff.js";
export type { RuffStageConfig } from "./stages/ruff.js";
export { StageRegistry } from "./stages/index.js";
export type { StageRegistryOptions } from "./stages/index.js";

// Tool runner utilities
export { runTool, locationsOverlap, extractMatchedCode, processToolFindings } from "./stages/tool-runner.js";
export type { ToolFinding, ToolRunResult, RunToolOptions } from "./stages/tool-runner.js";

// Loader
export { parseRuleYaml, loadRuleFromFile, buildPipeline } from "./loader/rule-loader.js";
export type { BuildPipelineOptions } from "./loader/rule-loader.js";
export { discoverFiles, discoverRuleFiles, detectLanguage } from "./loader/file-discovery.js";
export type { DiscoverFilesOptions } from "./loader/file-discovery.js";

// CLI (for programmatic use)
export { scan } from "./cli/scan.js";
export type { ScanOptions } from "./cli/scan.js";

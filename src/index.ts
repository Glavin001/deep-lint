// Core
export { executePipeline } from "./core/pipeline.js";
export type { PipelineConfig, PipelineResult, PipelineTrace, StageTraceEntry } from "./core/pipeline.js";
export { createCandidate } from "./core/candidate.js";
export type { Candidate, CreateCandidateOptions } from "./core/candidate.js";
export type { Stage, StageContext, StageFactory, CacheableStage } from "./core/stage.js";
export { isCacheableStage } from "./core/stage.js";
export type { RuleDefinition, StageDefinition } from "./core/rule.js";

// Types
export type { Severity, Language, FileContext, Location, LintResult } from "./types.js";

// Stages
export { createAstGrepStage } from "./stages/ast-grep.js";
export type { AstGrepStageConfig } from "./stages/ast-grep.js";
export { createLlmStage, interpolatePrompt, extractSurroundingLines, computeLlmCacheKey } from "./stages/llm.js";
export type { LlmStageConfig } from "./stages/llm.js";
export { StageRegistry } from "./stages/index.js";
export type { StageRegistryOptions } from "./stages/index.js";

// Cache
export type { CacheStore, CacheEntry } from "./cache/cache-store.js";
export { FsCacheStore } from "./cache/fs-cache-store.js";
export type { FsCacheStoreOptions } from "./cache/fs-cache-store.js";

// Loader
export { parseRuleYaml, loadRuleFromFile, buildPipeline } from "./loader/rule-loader.js";
export type { BuildPipelineOptions } from "./loader/rule-loader.js";
export { discoverFiles, discoverRuleFiles, detectLanguage } from "./loader/file-discovery.js";
export type { DiscoverFilesOptions } from "./loader/file-discovery.js";

// CLI (for programmatic use)
export { scan } from "./cli/scan.js";
export type { ScanOptions } from "./cli/scan.js";

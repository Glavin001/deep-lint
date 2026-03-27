import { resolve } from "node:path";
import type { LanguageModel } from "ai";
import { loadRuleFromFile, buildPipeline } from "../loader/rule-loader.js";
import { discoverFiles, discoverRuleFiles } from "../loader/file-discovery.js";
import { executePipeline } from "../core/pipeline.js";
import { jsonFormatter } from "./formatters/json.js";
import { prettyFormatter } from "./formatters/pretty.js";
import type { FormatterType } from "./formatters/index.js";
import type { LintResult } from "../types.js";

export interface ScanOptions {
  paths: string[];
  rulesDir: string;
  format: FormatterType;
  model?: LanguageModel;
  skipLlm?: boolean;
  severity?: string;
}

export async function scan(options: ScanOptions): Promise<{ output: string; hasErrors: boolean }> {
  const rulesDir = resolve(options.rulesDir);
  const ruleFiles = discoverRuleFiles(rulesDir);

  if (ruleFiles.length === 0) {
    return { output: `No rule files found in ${rulesDir}`, hasErrors: false };
  }

  const results: LintResult[] = [];

  for (const ruleFile of ruleFiles) {
    const rule = loadRuleFromFile(ruleFile);

    // Filter by severity if specified
    if (options.severity) {
      const severityOrder = { info: 0, warning: 1, error: 2 };
      const minSeverity = severityOrder[options.severity as keyof typeof severityOrder] ?? 0;
      const ruleSeverity = severityOrder[rule.severity] ?? 0;
      if (ruleSeverity < minSeverity) continue;
    }

    const pipeline = buildPipeline(rule, {
      model: options.model,
      skipLlm: options.skipLlm,
    });

    const files = discoverFiles({
      paths: options.paths.map((p) => resolve(p)),
      language: rule.language,
    });

    if (files.length === 0) continue;

    const result = await executePipeline(pipeline, files);

    const activeFindings = result.candidates.filter((c) => !c.filtered);
    if (activeFindings.length > 0) {
      results.push({
        ruleId: rule.id,
        severity: rule.severity,
        description: rule.description,
        candidates: result.candidates,
      });
    }
  }

  const formatter = options.format === "json" ? jsonFormatter : prettyFormatter;
  const output = formatter.format(results);

  const hasErrors = results.some(
    (r) => r.severity === "error" && r.candidates.some((c) => !c.filtered),
  );

  return { output, hasErrors };
}

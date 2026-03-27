import chalk from "chalk";
import type { Formatter } from "./index.js";
import type { LintResult } from "../../types.js";
import type { Severity } from "../../types.js";

const SEVERITY_COLORS: Record<Severity, (s: string) => string> = {
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,
};

const SEVERITY_ICONS: Record<Severity, string> = {
  error: "x",
  warning: "!",
  info: "i",
};

export const prettyFormatter: Formatter = {
  format(results: LintResult[]): string {
    const lines: string[] = [];
    let totalFindings = 0;

    for (const result of results) {
      const active = result.candidates.filter((c) => !c.filtered);
      if (active.length === 0) continue;

      for (const candidate of active) {
        totalFindings++;
        const color = SEVERITY_COLORS[result.severity];
        const icon = SEVERITY_ICONS[result.severity];

        const loc = `${candidate.location.filePath}:${candidate.location.startLine}:${candidate.location.startColumn}`;
        const sevLabel = color(`${icon} ${result.severity}`);
        const ruleLabel = chalk.dim(result.ruleId);

        lines.push(`  ${chalk.underline(loc)}  ${sevLabel}  ${result.description}  ${ruleLabel}`);

        // Show the matched code (truncated if long)
        const code = candidate.matchedCode.split("\n")[0];
        const displayCode = code.length > 120 ? code.slice(0, 117) + "..." : code;
        lines.push(`    ${chalk.dim(displayCode)}`);

        // Show LLM annotations if present
        if (candidate.annotations.llmConfidence !== undefined) {
          const conf = (candidate.annotations.llmConfidence as number).toFixed(2);
          const reasoning = candidate.annotations.llmReasoning as string;
          lines.push(`    ${chalk.cyan(`LLM confidence: ${conf}`)}${reasoning ? ` — ${reasoning}` : ""}`);
        }

        lines.push("");
      }
    }

    if (totalFindings === 0) {
      lines.push(chalk.green("  No issues found."));
      lines.push("");
    } else {
      const errorCount = results.reduce(
        (acc, r) => acc + (r.severity === "error" ? r.candidates.filter((c) => !c.filtered).length : 0),
        0,
      );
      const warningCount = results.reduce(
        (acc, r) => acc + (r.severity === "warning" ? r.candidates.filter((c) => !c.filtered).length : 0),
        0,
      );
      const infoCount = results.reduce(
        (acc, r) => acc + (r.severity === "info" ? r.candidates.filter((c) => !c.filtered).length : 0),
        0,
      );

      const parts: string[] = [];
      if (errorCount > 0) parts.push(chalk.red(`${errorCount} error${errorCount > 1 ? "s" : ""}`));
      if (warningCount > 0) parts.push(chalk.yellow(`${warningCount} warning${warningCount > 1 ? "s" : ""}`));
      if (infoCount > 0) parts.push(chalk.blue(`${infoCount} info`));

      lines.push(`  ${parts.join(", ")} found.`);
      lines.push("");
    }

    return lines.join("\n");
  },
};

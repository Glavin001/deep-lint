import type { Formatter } from "./index.js";
import type { LintResult } from "../../types.js";

export const jsonFormatter: Formatter = {
  format(results: LintResult[]): string {
    const output = results.flatMap((result) =>
      result.candidates
        .filter((c) => !c.filtered)
        .map((c) => ({
          ruleId: result.ruleId,
          severity: result.severity,
          description: result.description,
          file: c.location.filePath,
          line: c.location.startLine,
          column: c.location.startColumn,
          endLine: c.location.endLine,
          endColumn: c.location.endColumn,
          matchedCode: c.matchedCode,
          metaVariables: c.metaVariables,
          annotations: c.annotations,
        })),
    );
    return JSON.stringify(output, null, 2);
  },
};

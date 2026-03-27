import type { LintResult } from "../../types.js";

export interface Formatter {
  format(results: LintResult[]): string;
}

export type FormatterType = "json" | "pretty";

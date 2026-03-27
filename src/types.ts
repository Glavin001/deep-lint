export type Severity = "error" | "warning" | "info";

export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "html"
  | "css";

export interface FileContext {
  filePath: string;
  content: string;
  language: Language;
}

export interface Location {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface LintResult {
  ruleId: string;
  severity: Severity;
  description: string;
  candidates: import("./core/candidate.js").Candidate[];
}

import type { Language, Severity } from "../types.js";

export interface StageDefinition {
  type: string;
  config: Record<string, unknown>;
}

export interface RuleDefinition {
  id: string;
  language: Language;
  severity: Severity;
  description: string;
  pipeline: StageDefinition[];
}

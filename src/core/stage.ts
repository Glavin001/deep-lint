import type { Candidate } from "./candidate.js";

export interface StageContext {
  signal?: AbortSignal;
}

export interface Stage {
  readonly name: string;
  process(candidates: Candidate[], context: StageContext): Promise<Candidate[]>;
}

export type StageFactory = (config: Record<string, unknown>) => Stage;

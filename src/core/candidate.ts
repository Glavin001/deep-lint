import { createHash } from "node:crypto";
import type { FileContext, Location } from "../types.js";

export interface Candidate {
  id: string;
  ruleId: string;
  location: Location;
  matchedCode: string;
  metaVariables: Record<string, string>;
  annotations: Record<string, unknown>;
  filtered: boolean;
  fileContext: FileContext;
}

export interface CreateCandidateOptions {
  ruleId: string;
  location: Location;
  matchedCode: string;
  metaVariables?: Record<string, string>;
  fileContext: FileContext;
}

export function createCandidate(options: CreateCandidateOptions): Candidate {
  const id = createHash("sha256")
    .update(
      `${options.ruleId}:${options.location.filePath}:${options.location.startLine}:${options.location.startColumn}:${options.location.endLine}:${options.location.endColumn}`
    )
    .digest("hex")
    .slice(0, 16);

  return {
    id,
    ruleId: options.ruleId,
    location: options.location,
    matchedCode: options.matchedCode,
    metaVariables: options.metaVariables ?? {},
    annotations: {},
    filtered: false,
    fileContext: options.fileContext,
  };
}

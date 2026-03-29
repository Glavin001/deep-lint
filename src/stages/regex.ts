import { createCandidate, type Candidate } from "../core/candidate.js";
import type { Stage, StageContext } from "../core/stage.js";

export interface RegexStageConfig {
  pattern: string;
  flags?: string;
  invert?: boolean;
}

export function createRegexStage(config: RegexStageConfig): Stage {
  const baseFlags = config.flags ?? "";
  // Always use 'g' for producer mode scanning; for filter mode we test per-candidate
  const globalFlags = baseFlags.includes("g") ? baseFlags : baseFlags + "g";
  const invert = config.invert ?? false;

  return {
    name: "regex",

    async process(candidates: Candidate[], _context: StageContext): Promise<Candidate[]> {
      const results: Candidate[] = [];

      for (const candidate of candidates) {
        if (candidate.filtered) {
          results.push(candidate);
          continue;
        }

        const isSeed = candidate.matchedCode === "" && candidate.location.startLine === 0;

        if (isSeed) {
          // Producer mode: scan file content, create candidates per match
          const regex = new RegExp(config.pattern, globalFlags);
          const lines = candidate.fileContext.content.split("\n");

          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            regex.lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = regex.exec(line)) !== null) {
              const metaVariables: Record<string, string> = {};

              // Named capture groups
              if (match.groups) {
                for (const [name, value] of Object.entries(match.groups)) {
                  if (value !== undefined) {
                    metaVariables[name] = value;
                  }
                }
              }

              // Positional capture groups
              for (let i = 1; i < match.length; i++) {
                if (match[i] !== undefined) {
                  metaVariables[String(i)] = match[i];
                }
              }

              results.push(
                createCandidate({
                  ruleId: candidate.ruleId,
                  location: {
                    filePath: candidate.fileContext.filePath,
                    startLine: lineIndex + 1, // 1-indexed
                    startColumn: match.index,
                    endLine: lineIndex + 1,
                    endColumn: match.index + match[0].length,
                  },
                  matchedCode: match[0],
                  metaVariables,
                  fileContext: candidate.fileContext,
                }),
              );

              // Prevent infinite loop on zero-length matches
              if (match[0].length === 0) {
                regex.lastIndex++;
              }
            }
          }
        } else {
          // Filter mode: test regex against matchedCode
          const regex = new RegExp(config.pattern, baseFlags);
          const matches = regex.test(candidate.matchedCode);
          const shouldFilter = invert ? matches : !matches;

          if (shouldFilter) {
            results.push({ ...candidate, filtered: true });
          } else {
            // Extract capture groups into metavariables
            const execRegex = new RegExp(config.pattern, baseFlags);
            const match = execRegex.exec(candidate.matchedCode);
            if (match) {
              const newMetaVars = { ...candidate.metaVariables };
              if (match.groups) {
                for (const [name, value] of Object.entries(match.groups)) {
                  if (value !== undefined) {
                    newMetaVars[name] = value;
                  }
                }
              }
              for (let i = 1; i < match.length; i++) {
                if (match[i] !== undefined) {
                  newMetaVars[String(i)] = match[i];
                }
              }
              results.push({ ...candidate, metaVariables: newMetaVars });
            } else {
              results.push(candidate);
            }
          }
        }
      }

      return results;
    },
  };
}

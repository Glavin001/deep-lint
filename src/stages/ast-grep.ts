import { parse } from "@ast-grep/napi";
import { createCandidate, type Candidate } from "../core/candidate.js";
import type { Stage, StageContext } from "../core/stage.js";
import type { Language } from "../types.js";

const LANGUAGE_MAP: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  tsx: "Tsx",
  jsx: "Jsx",
  html: "Html",
  css: "Css",
};

export function resolveAstGrepLang(language: Language | string): string {
  const mapped = LANGUAGE_MAP[language];
  if (!mapped) {
    throw new Error(
      `Unsupported language for ast-grep: "${language}". Supported: ${Object.keys(LANGUAGE_MAP).join(", ")}`,
    );
  }
  return mapped;
}

export interface AstGrepStageConfig {
  pattern: string;
  language?: Language;
}

export function createAstGrepStage(config: AstGrepStageConfig): Stage {
  return {
    name: "ast-grep",

    async process(candidates: Candidate[], _context: StageContext): Promise<Candidate[]> {
      const results: Candidate[] = [];

      for (const seed of candidates) {
        if (seed.filtered) {
          results.push(seed);
          continue;
        }

        const lang = config.language ?? seed.fileContext.language;
        const astLang = resolveAstGrepLang(lang);
        const root = parse(astLang, seed.fileContext.content);
        const matches = root.root().findAll(config.pattern);

        for (const match of matches) {
          const range = match.range();
          const metaVariables: Record<string, string> = {};

          // Extract single metavariables ($VAR)
          // We need to try common metavariable names from the pattern
          const singleVarMatches = config.pattern.match(/\$([A-Z_][A-Z0-9_]*)/g);
          if (singleVarMatches) {
            const seen = new Set<string>();
            for (const varMatch of singleVarMatches) {
              // Skip $$$ multi-match vars
              if (varMatch.startsWith("$$$")) continue;
              const name = varMatch.replace(/^\$\$?\$?/, "");
              if (seen.has(name)) continue;
              seen.add(name);

              const node = match.getMatch(name);
              if (node) {
                metaVariables[name] = node.text();
              }
            }
          }

          // Extract multi-match metavariables ($$$VAR)
          const multiVarMatches = config.pattern.match(/\$\$\$([A-Z_][A-Z0-9_]*)/g);
          if (multiVarMatches) {
            const seen = new Set<string>();
            for (const varMatch of multiVarMatches) {
              const name = varMatch.replace(/^\$\$\$/, "");
              if (seen.has(name)) continue;
              seen.add(name);

              const nodes = match.getMultipleMatches(name);
              if (nodes && nodes.length > 0) {
                // Filter out punctuation nodes (commas, etc.) and join
                const texts = nodes
                  .filter((n) => n.text().trim() && n.text().trim() !== ",")
                  .map((n) => n.text());
                metaVariables[name] = texts.join(", ");
              }
            }
          }

          results.push(
            createCandidate({
              ruleId: seed.ruleId,
              location: {
                filePath: seed.fileContext.filePath,
                startLine: range.start.line + 1, // convert 0-indexed to 1-indexed
                startColumn: range.start.column,
                endLine: range.end.line + 1,
                endColumn: range.end.column,
              },
              matchedCode: match.text(),
              metaVariables,
              fileContext: seed.fileContext,
            }),
          );
        }
      }

      return results;
    },
  };
}

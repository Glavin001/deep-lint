import type { Candidate } from "../core/candidate.js";
import type { Stage, StageContext } from "../core/stage.js";
import {
  runTool,
  processToolFindings,
  LANGUAGE_EXTENSIONS,
  type ToolFinding,
} from "./tool-runner.js";

export interface SemgrepStageConfig {
  pattern?: string;
  language?: string;
  rule?: string;
}

interface SemgrepResult {
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message?: string;
    metavars?: Record<string, { abstract_content: string }>;
    metadata?: Record<string, unknown>;
    lines?: string;
  };
  check_id: string;
}

interface SemgrepOutput {
  results: SemgrepResult[];
}

function parseSemgrepOutput(stdout: string, filePath: string): ToolFinding[] {
  let parsed: SemgrepOutput;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  return parsed.results.map((r) => {
    const metaVariables: Record<string, string> = {};
    if (r.extra.metavars) {
      for (const [name, value] of Object.entries(r.extra.metavars)) {
        // Semgrep metavars are like $X — strip the $ prefix for our format
        const cleanName = name.startsWith("$") ? name.slice(1) : name;
        metaVariables[cleanName] = value.abstract_content;
      }
    }

    return {
      location: {
        filePath,
        startLine: r.start.line,
        startColumn: r.start.col - 1, // Semgrep is 1-indexed for columns
        endLine: r.end.line,
        endColumn: r.end.col - 1,
      },
      message: r.extra.message ?? r.check_id,
      ruleId: r.check_id,
      matchedCode: r.extra.lines === "requires login" ? undefined : r.extra.lines,
      metaVariables,
      annotations: {
        semgrepCheckId: r.check_id,
        semgrepMetadata: r.extra.metadata,
      },
    };
  });
}

export function createSemgrepStage(config: SemgrepStageConfig): Stage {
  if (!config.pattern && !config.rule) {
    throw new Error("Semgrep stage requires either 'pattern' or 'rule' config");
  }

  return {
    name: "semgrep",

    async process(candidates: Candidate[], _context: StageContext): Promise<Candidate[]> {
      const fileMap = new Map<string, Candidate[]>();
      for (const c of candidates) {
        if (c.filtered) continue;
        const key = c.fileContext.filePath;
        if (!fileMap.has(key)) fileMap.set(key, []);
        fileMap.get(key)!.push(c);
      }

      const findingsMap = new Map<string, ToolFinding[]>();

      for (const [filePath, fileCandidates] of fileMap) {
        const fc = fileCandidates[0].fileContext;
        const ext = LANGUAGE_EXTENSIONS[fc.language] ?? ".js";

        const args: string[] = [];
        if (config.pattern) {
          args.push("--pattern", config.pattern);
          const lang = config.language ?? fc.language;
          args.push("--lang", lang);
        } else if (config.rule) {
          args.push("--config", config.rule);
        }
        args.push("--json", "--quiet", "__TEMPFILE__");

        try {
          const result = await runTool(
            {
              command: "semgrep",
              args,
              toolName: "Semgrep",
              parseOutput: parseSemgrepOutput,
              findingExitCodes: [0, 1],
            },
            fc.content,
            filePath,
            ext,
          );

          findingsMap.set(filePath, result.findings);
        } catch (error) {
          return candidates.map((c) => ({
            ...c,
            filtered: true,
            annotations: {
              ...c.annotations,
              toolError: error instanceof Error ? error.message : String(error),
            },
          }));
        }
      }

      return processToolFindings(candidates, findingsMap);
    },
  };
}

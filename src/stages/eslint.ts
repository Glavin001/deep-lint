import type { Candidate } from "../core/candidate.js";
import type { Stage, StageContext } from "../core/stage.js";
import {
  runTool,
  processToolFindings,
  LANGUAGE_EXTENSIONS,
  type ToolFinding,
} from "./tool-runner.js";

export interface EslintStageConfig {
  rules: Record<string, unknown>;
}

interface EslintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

function parseEslintOutput(stdout: string, filePath: string): ToolFinding[] {
  let parsed: EslintFileResult[];
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  const findings: ToolFinding[] = [];
  for (const fileResult of parsed) {
    for (const msg of fileResult.messages) {
      // Skip messages without a ruleId — these are config/ignore warnings, not lint findings
      if (!msg.ruleId) continue;
      findings.push({
        location: {
          filePath,
          startLine: msg.line,
          startColumn: msg.column - 1, // ESLint is 1-indexed for columns
          endLine: msg.endLine ?? msg.line,
          endColumn: msg.endColumn ? msg.endColumn - 1 : msg.column,
        },
        message: msg.message,
        ruleId: msg.ruleId ?? "unknown",
        annotations: {
          eslintSeverity: msg.severity,
          eslintRuleId: msg.ruleId,
        },
      });
    }
  }
  return findings;
}

export function createEslintStage(config: EslintStageConfig): Stage {
  // Build --rule arguments from config
  const ruleArg = JSON.stringify(config.rules);

  return {
    name: "eslint",

    async process(candidates: Candidate[], _context: StageContext): Promise<Candidate[]> {
      // Group candidates by file, run ESLint once per file
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

        try {
          const result = await runTool(
            {
              command: "npx",
              args: [
                "eslint",
                "--no-config-lookup",
                "--rule", ruleArg,
                "--format", "json",
                "__TEMPFILE__",
              ],
              toolName: "ESLint",
              parseOutput: parseEslintOutput,
              findingExitCodes: [0, 1],
            },
            fc.content,
            filePath,
            ext,
          );

          findingsMap.set(filePath, result.findings);
        } catch (error) {
          // Tool not available — filter all candidates (no findings possible)
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

import type { Candidate } from "../core/candidate.js";
import type { Stage, StageContext } from "../core/stage.js";
import {
  runTool,
  processToolFindings,
  type ToolFinding,
} from "./tool-runner.js";

export interface RuffStageConfig {
  select: string[];
}

interface RuffDiagnostic {
  code: string | null;
  message: string;
  location: { row: number; column: number };
  end_location: { row: number; column: number };
  filename: string;
}

function parseRuffOutput(stdout: string, filePath: string): ToolFinding[] {
  let parsed: RuffDiagnostic[];
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  return parsed.map((d) => ({
    location: {
      filePath,
      startLine: d.location.row,
      startColumn: d.location.column - 1, // Ruff is 1-indexed for columns
      endLine: d.end_location.row,
      endColumn: d.end_location.column - 1,
    },
    message: d.message,
    ruleId: d.code ?? "unknown",
    annotations: {
      ruffCode: d.code,
    },
  }));
}

export function createRuffStage(config: RuffStageConfig): Stage {
  if (!config.select || config.select.length === 0) {
    throw new Error("Ruff stage requires a non-empty 'select' array of rule codes");
  }

  const selectArg = config.select.join(",");

  return {
    name: "ruff",

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

        try {
          const result = await runTool(
            {
              command: "ruff",
              args: [
                "check",
                "--select", selectArg,
                "--output-format", "json",
                "--isolated",
                "__TEMPFILE__",
              ],
              toolName: "Ruff",
              parseOutput: parseRuffOutput,
              findingExitCodes: [0, 1],
            },
            fc.content,
            filePath,
            ".py",
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

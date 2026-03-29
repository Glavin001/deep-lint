import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCandidate, type Candidate } from "../core/candidate.js";
import type { Location } from "../types.js";

const execFileAsync = promisify(execFile);

export interface ToolFinding {
  location: Location;
  message: string;
  ruleId: string;
  matchedCode?: string;
  metaVariables?: Record<string, string>;
  annotations?: Record<string, unknown>;
}

export interface ToolRunResult {
  findings: ToolFinding[];
}

export interface RunToolOptions {
  command: string;
  args: string[];
  /** Tool name for error messages */
  toolName: string;
  /** Parse stdout into findings */
  parseOutput: (stdout: string, filePath: string) => ToolFinding[];
  /** Exit codes that indicate findings (not errors). Default: [0, 1] */
  findingExitCodes?: number[];
}

/**
 * Writes file content to a temp file, runs a tool, parses output, cleans up.
 */
export async function runTool(
  options: RunToolOptions,
  fileContent: string,
  filePath: string,
  fileExtension: string,
): Promise<ToolRunResult> {
  const tempDir = mkdtempSync(join(tmpdir(), "deep-lint-"));
  const tempFile = join(tempDir, `lint${fileExtension}`);
  const findingExitCodes = new Set(options.findingExitCodes ?? [0, 1]);

  try {
    writeFileSync(tempFile, fileContent, "utf-8");

    const args = options.args.map((a) => a.replace("__TEMPFILE__", tempFile));

    try {
      const { stdout } = await execFileAsync(options.command, args, {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: tempDir,
      });
      return { findings: options.parseOutput(stdout, filePath) };
    } catch (err: unknown) {
      const execErr = err as { code?: string | number; stdout?: string; stderr?: string; status?: number };

      // Tool not found
      if (execErr.code === "ENOENT") {
        throw new Error(
          `${options.toolName} not found. Install it to use the ${options.toolName} stage. ` +
          `Command: ${options.command}`,
        );
      }

      // Tool exited with findings (many linters exit 1 when they find issues)
      const exitCode = execErr.status ?? (typeof execErr.code === "number" ? execErr.code : -1);
      if (findingExitCodes.has(exitCode) && execErr.stdout) {
        return { findings: options.parseOutput(execErr.stdout, filePath) };
      }

      // Actual tool error
      throw new Error(
        `${options.toolName} failed (exit ${exitCode}): ${execErr.stderr || execErr.stdout || String(err)}`,
      );
    }
  } finally {
    try {
      unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Checks if two locations overlap (share any lines).
 */
export function locationsOverlap(a: Location, b: Location): boolean {
  if (a.filePath !== b.filePath) return false;
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * Extract source code at a given location from file content.
 */
export function extractMatchedCode(content: string, location: Location): string {
  const lines = content.split("\n");
  const startIdx = location.startLine - 1; // convert 1-indexed to 0-indexed
  const endIdx = location.endLine - 1;

  if (startIdx < 0 || endIdx >= lines.length) return "";

  if (startIdx === endIdx) {
    return lines[startIdx].substring(location.startColumn, location.endColumn);
  }

  const extracted: string[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    if (i === startIdx) {
      extracted.push(lines[i].substring(location.startColumn));
    } else if (i === endIdx) {
      extracted.push(lines[i].substring(0, location.endColumn));
    } else {
      extracted.push(lines[i]);
    }
  }
  return extracted.join("\n");
}

/**
 * Shared logic for tool integration stages operating in producer or filter mode.
 */
export function processToolFindings(
  candidates: Candidate[],
  findingsMap: Map<string, ToolFinding[]>,
): Candidate[] {
  const results: Candidate[] = [];

  for (const candidate of candidates) {
    if (candidate.filtered) {
      results.push(candidate);
      continue;
    }

    const isSeed = candidate.matchedCode === "" && candidate.location.startLine === 0;
    const findings = findingsMap.get(candidate.fileContext.filePath) ?? [];

    if (isSeed) {
      // Producer mode: create candidates from findings
      for (const finding of findings) {
        const matchedCode = finding.matchedCode ??
          extractMatchedCode(candidate.fileContext.content, finding.location);

        results.push(
          createCandidate({
            ruleId: candidate.ruleId,
            location: finding.location,
            matchedCode,
            metaVariables: finding.metaVariables,
            fileContext: candidate.fileContext,
          }),
        );

        // Add tool-specific annotations
        if (finding.annotations || finding.ruleId || finding.message) {
          const last = results[results.length - 1];
          results[results.length - 1] = {
            ...last,
            annotations: {
              ...last.annotations,
              ...finding.annotations,
              toolRuleId: finding.ruleId,
              toolMessage: finding.message,
            },
          };
        }
      }
    } else {
      // Filter mode: check if any finding overlaps with this candidate's location
      const overlapping = findings.filter((f) =>
        locationsOverlap(candidate.location, f.location),
      );

      if (overlapping.length === 0) {
        results.push({ ...candidate, filtered: true });
      } else {
        // Keep candidate, add tool annotations from overlapping findings
        const finding = overlapping[0];
        results.push({
          ...candidate,
          annotations: {
            ...candidate.annotations,
            ...finding.annotations,
            toolRuleId: finding.ruleId,
            toolMessage: finding.message,
          },
        });
      }
    }
  }

  return results;
}

/** File extension mapping for languages */
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  typescript: ".ts",
  javascript: ".js",
  tsx: ".tsx",
  jsx: ".jsx",
  python: ".py",
  go: ".go",
  rust: ".rs",
  java: ".java",
  c: ".c",
  cpp: ".cpp",
  html: ".html",
  css: ".css",
};

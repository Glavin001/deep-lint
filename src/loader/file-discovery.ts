import { globSync } from "glob";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { FileContext, Language } from "../types.js";

const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".html": "html",
  ".css": "css",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
};

const LANGUAGE_TO_EXTENSIONS: Record<string, string[]> = {
  typescript: ["**/*.ts"],
  tsx: ["**/*.tsx"],
  javascript: ["**/*.js", "**/*.mjs", "**/*.cjs"],
  jsx: ["**/*.jsx"],
  html: ["**/*.html"],
  css: ["**/*.css"],
  python: ["**/*.py"],
  go: ["**/*.go"],
  rust: ["**/*.rs"],
  java: ["**/*.java"],
  c: ["**/*.c"],
  cpp: ["**/*.cpp", "**/*.cc", "**/*.cxx"],
};

export function detectLanguage(filePath: string): Language | null {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? null;
}

export interface DiscoverFilesOptions {
  paths: string[];
  language?: Language;
  ignore?: string[];
}

export function discoverFiles(options: DiscoverFilesOptions): FileContext[] {
  const { paths, language, ignore = ["**/node_modules/**", "**/dist/**"] } = options;

  const patterns =
    language && LANGUAGE_TO_EXTENSIONS[language]
      ? LANGUAGE_TO_EXTENSIONS[language]
      : ["**/*"];

  const files: FileContext[] = [];
  const seen = new Set<string>();

  for (const basePath of paths) {
    for (const pattern of patterns) {
      const matches = globSync(pattern, {
        cwd: basePath,
        absolute: true,
        nodir: true,
        ignore,
      });

      for (const filePath of matches) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);

        const detectedLang = detectLanguage(filePath);
        if (!detectedLang) continue;

        // If a language filter is specified, only include matching files
        if (language && detectedLang !== language) continue;

        files.push({
          filePath,
          content: readFileSync(filePath, "utf-8"),
          language: detectedLang,
        });
      }
    }
  }

  return files;
}

export function discoverRuleFiles(rulesDir: string): string[] {
  return globSync("**/*.{yaml,yml}", {
    cwd: rulesDir,
    absolute: true,
    nodir: true,
  });
}

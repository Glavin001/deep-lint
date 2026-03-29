import { resolve } from "node:path";
import { Command } from "commander";
import { scan } from "./cli/scan.js";
import { FsCacheStore } from "./cache/fs-cache-store.js";
import type { FormatterType } from "./cli/formatters/index.js";

const program = new Command();

program
  .name("deep-lint")
  .description(
    "Composable multi-stage lint pipelines — chain ast-grep, regex, ESLint, Semgrep, Ruff, and LLM review in declarative YAML rules.",
  )
  .version("0.1.0");

program
  .command("scan")
  .description("Run lint rules against source files")
  .argument("[paths...]", "Paths to scan", ["."])
  .option("-r, --rules <dir>", "Path to rules directory", "./rules")
  .option("-f, --format <format>", "Output format: json | pretty", "pretty")
  .option("--no-llm", "Skip LLM stages")
  .option("--severity <level>", "Minimum severity: info | warning | error")
  .option("--cache", "Enable caching for LLM stages")
  .option("--cache-dir <path>", "Cache directory", ".deep-lint/cache")
  .option("--clear-cache", "Clear the cache before running")
  .action(async (paths: string[], opts) => {
    try {
      const scanPaths = paths.length > 0 ? paths : ["."];

      let cacheStore: FsCacheStore | undefined;
      if (opts.cache || opts.clearCache) {
        const cacheDir = resolve(opts.cacheDir);
        cacheStore = new FsCacheStore({ cacheDir });

        if (opts.clearCache) {
          await cacheStore.clear();
          if (!opts.cache) {
            process.stdout.write("Cache cleared.\n");
            return;
          }
        }
      }

      const result = await scan({
        paths: scanPaths,
        rulesDir: opts.rules,
        format: opts.format as FormatterType,
        skipLlm: !opts.llm,
        severity: opts.severity,
        cacheStore,
      });

      process.stdout.write(result.output + "\n");

      if (result.hasErrors) {
        process.exitCode = 1;
      }
    } catch (error) {
      if (error instanceof Error) {
        process.stderr.write(`Error: ${error.message}\n`);
      } else {
        process.stderr.write(`Error: ${String(error)}\n`);
      }
      process.exitCode = 1;
    }
  });

program.parse();

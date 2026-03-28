import { Command } from "commander";
import { scan } from "./cli/scan.js";
import type { FormatterType } from "./cli/formatters/index.js";

const program = new Command();

program
  .name("deep-lint")
  .description(
    "Composable multi-stage lint rules — from pattern matching to type checking to LLM review.",
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
  .action(async (paths: string[], opts) => {
    try {
      const scanPaths = paths.length > 0 ? paths : ["."];
      const result = await scan({
        paths: scanPaths,
        rulesDir: opts.rules,
        format: opts.format as FormatterType,
        skipLlm: !opts.llm,
        severity: opts.severity,
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

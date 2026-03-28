# deep-lint

Composable multi-stage lint rules — from pattern matching to type checking to LLM review.

## Features

- **Multi-stage pipelines**: Chain structural matching, LLM review, and more
- **ast-grep integration**: Fast, precise structural code matching via `@ast-grep/napi`
- **LLM-powered review**: Use any LLM provider via Vercel AI SDK (OpenAI, Anthropic, Ollama, etc.)
- **YAML rule definitions**: Declarative, composable rule configs
- **CLI + programmatic API**: Use from the command line or embed in your tools
- **TypeScript-first**: Full type safety and IntelliSense

## Quick Start

```bash
npm install deep-lint
```

### CLI Usage

```bash
# Run all rules (structural only, no LLM)
npx deep-lint scan --rules ./rules --no-llm ./src

# Run with LLM stages (requires model configuration)
npx deep-lint scan --rules ./rules ./src

# JSON output
npx deep-lint scan --rules ./rules --no-llm --format json ./src

# Filter by severity
npx deep-lint scan --rules ./rules --severity error ./src
```

### Writing Rules

Rules are YAML files with a pipeline of stages:

```yaml
# rules/no-console-log.yaml
id: no-console-log
language: typescript
severity: warning
description: "Avoid console.log in production code"
pipeline:
  - ast-grep:
      pattern: "console.log($$$ARGS)"
```

Multi-stage rule with LLM review:

```yaml
# rules/ensure-error-handling.yaml
id: ensure-error-handling
language: typescript
severity: warning
description: "Async functions should have error handling"
pipeline:
  - ast-grep:
      pattern: "async function $FUNC($$$PARAMS) { $$$BODY }"
  - llm:
      prompt: |
        Does this async function have proper error handling?
        Function: $FUNC
        Code:
        $MATCHED_CODE
      confidence_threshold: 0.7
```

### Programmatic API

```typescript
import {
  parseRuleYaml,
  buildPipeline,
  executePipeline,
} from "deep-lint";

const rule = parseRuleYaml(`
id: no-console-log
language: typescript
severity: warning
description: "No console.log"
pipeline:
  - ast-grep:
      pattern: "console.log($$$ARGS)"
`);

const pipeline = buildPipeline(rule, { skipLlm: true });
const result = await executePipeline(pipeline, [
  {
    filePath: "app.ts",
    content: 'console.log("hello");',
    language: "typescript",
  },
]);

const findings = result.candidates.filter((c) => !c.filtered);
console.log(`Found ${findings.length} violations`);
```

### Using with an LLM

```typescript
import { buildPipeline } from "deep-lint";
import { anthropic } from "@ai-sdk/anthropic";

const pipeline = buildPipeline(rule, {
  model: anthropic("claude-sonnet-4-20250514"),
});
```

Any Vercel AI SDK compatible provider works: OpenAI, Anthropic, Google, Ollama, etc.

## Stages

| Stage | Description |
|-------|-------------|
| `ast-grep` | Structural code matching using ast-grep patterns |
| `llm` | LLM-based code review with configurable prompts |

## Pipeline Model

1. The first stage (typically `ast-grep`) **produces** candidates from source files
2. Subsequent stages **filter** and **annotate** candidates
3. Candidates marked `filtered: true` are excluded from results but preserved in traces
4. The pipeline short-circuits when all candidates are filtered

## Development

```bash
npm install
npm test          # Run all tests
npm run build     # Build with tsup
npm run lint      # Type-check
```

## License

MIT

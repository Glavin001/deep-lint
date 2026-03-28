# deep-lint

Composable multi-stage lint rules — from pattern matching to type checking to LLM review.

## Why deep-lint?

Traditional linters are single-pass: they find patterns and report. But real-world code quality problems require **combining multiple tools**. ESLint finds `eval()` but can't tell if the input is user-controlled. Semgrep finds `x == x` but can't tell if it's a NaN check. Ruff flags `pickle.load` but can't tell if the data is trusted.

deep-lint **orchestrates** the best linting tools in multi-stage pipelines:

```
File → [ast-grep: find pattern] → [regex: filter text] → [LLM: judge intent]
```

Each stage does what it's best at. The pipeline narrows candidates progressively, so expensive analysis (LLM) only runs on the few ambiguous cases.

## Features

- **Multi-stage pipelines**: Chain structural matching, regex, tool integrations, and LLM review
- **ast-grep integration**: Fast, precise structural code matching via `@ast-grep/napi`
- **Regex stage**: Lightweight text pattern matching with capture groups
- **ESLint integration**: Leverage ESLint's mature JS/TS analysis as a pipeline stage
- **Semgrep integration**: Use Semgrep's powerful multi-language SAST patterns
- **Ruff integration**: Tap into Ruff's blazing-fast Python linting
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

| Stage | Description | Use case |
|-------|-------------|----------|
| `ast-grep` | Structural code matching using ast-grep patterns | Find code by AST structure (functions, calls, patterns) |
| `regex` | Regular expression matching with capture groups | Find text patterns, filter by content, extract data |
| `eslint` | ESLint integration for JS/TS analysis | Leverage ESLint's mature rule ecosystem |
| `semgrep` | Semgrep integration for multi-language SAST | Security patterns, taint tracking, cross-function analysis |
| `ruff` | Ruff integration for Python linting | Fast Python analysis (replaces Pylint/Flake8) |
| `llm` | LLM-based semantic code review | Judge intent, evaluate context, reduce false positives |

### Stage Configuration

**ast-grep** — structural code matching:
```yaml
- ast-grep:
    pattern: "console.log($$$ARGS)"    # ast-grep pattern syntax
    language: typescript                 # optional, defaults to rule language
```

**regex** — text pattern matching:
```yaml
- regex:
    pattern: "TODO|FIXME|HACK"          # regex pattern
    flags: "i"                           # optional: regex flags
    invert: false                        # optional: invert match (filter OUT matches)
```

**eslint** — JavaScript/TypeScript linting:
```yaml
- eslint:
    rules:
      no-eval: error
      complexity: [error, 10]
```

**semgrep** — multi-language SAST:
```yaml
- semgrep:
    pattern: "$X == $X"                 # inline pattern
    language: typescript                 # language for pattern mode
    # OR:
    rule: "path/to/semgrep-rule.yaml"   # external rule file
```

**ruff** — Python linting:
```yaml
- ruff:
    select:
      - "S301"                           # suspicious-pickle-usage
      - "S608"                           # hardcoded-sql-expression
```

**llm** — semantic analysis:
```yaml
- llm:
    prompt: |
      Is this code safe? $MATCHED_CODE
      Variable: $VAR
    confidence_threshold: 0.7
```

## Pipeline Model

1. The first stage (typically `ast-grep`, `regex`, or a tool integration) **produces** candidates from source files
2. Subsequent stages **filter** and **annotate** candidates
3. Candidates marked `filtered: true` are excluded from results but preserved in traces
4. The pipeline short-circuits when all candidates are filtered
5. Each stage narrows the candidate set — expensive stages (LLM) run last on fewer candidates

## Real-World Examples

### TODO tracking without blanket bans (regex + regex)

ESLint's `no-warning-comments` bans all TODOs. Deep-lint only flags TODOs missing an issue reference:

```yaml
id: no-todo-without-issue
language: typescript
severity: warning
description: "TODO/FIXME/HACK comments must reference a tracking issue"
pipeline:
  - regex:
      pattern: "(?<tag>TODO|FIXME|HACK)[:(]?\\s*(?<message>.*)"
  - regex:
      pattern: "(#\\d+|[A-Z]+-\\d+|https?://)"
      invert: true    # Filter OUT matches — keep only TODOs WITHOUT issue refs
```

### Smart eval() detection (ESLint + LLM)

ESLint's `no-eval` bans all `eval()`. Deep-lint lets ESLint find them, then LLM judges if the input is actually dangerous:

```yaml
id: no-unsafe-eval
language: typescript
severity: error
description: "Flag eval() with untrusted input, allow eval of trusted/static content"
pipeline:
  - eslint:
      rules:
        no-eval: error
  - llm:
      prompt: |
        ESLint flagged this eval(). Is the input user-controlled (dangerous)
        or trusted/static (safe)?
        Code: $MATCHED_CODE
      confidence_threshold: 0.8
```

### Tautological comparison detection (Semgrep + LLM)

Semgrep finds `x == x` patterns, but `value !== value` is an intentional NaN check in JavaScript. LLM tells them apart:

```yaml
id: no-tautological-comparison
language: typescript
severity: warning
description: "Flag comparisons of a value with itself (likely copy-paste bug)"
pipeline:
  - semgrep:
      pattern: "$X == $X"
  - llm:
      prompt: |
        Is this self-comparison intentional (NaN check) or a bug?
        Code: $MATCHED_CODE
      confidence_threshold: 0.7
```

### Unsafe pickle detection (Ruff + LLM)

Ruff's S301 flags all `pickle.load()`. Deep-lint uses Ruff's speed, then LLM evaluates data source trust:

```yaml
id: no-unsafe-pickle
language: python
severity: error
description: "Flag pickle deserialization of untrusted data"
pipeline:
  - ruff:
      select: ["S301"]
  - llm:
      prompt: |
        Is the data source trusted (cache, test fixture) or untrusted (user upload, network)?
        Code: $MATCHED_CODE
      confidence_threshold: 0.8
```

### 3-stage floating promise detection (ast-grep + regex + LLM)

The showcase pipeline — three tools, each doing what it's best at:

```yaml
id: no-unhandled-promise
language: typescript
severity: error
description: "Promise-returning calls must be awaited, caught, or explicitly voided"
pipeline:
  - ast-grep:
      pattern: "$FUNC($$$ARGS)"           # Stage 1: find all function calls
  - regex:
      pattern: "(await |return |void |\\.then|\\.catch)"
      invert: true                          # Stage 2: filter out already-handled calls
  - llm:
      prompt: |
        Is the missing await intentional (fire-and-forget logging)
        or a bug (data lost)?
        Code: $MATCHED_CODE
      confidence_threshold: 0.8             # Stage 3: judge the remaining cases
```

## Supported Languages

TypeScript, JavaScript, TSX, JSX, Python, Go, Rust, Java, C, C++, HTML, CSS

## Development

```bash
npm install
npm test          # Run all tests
npm run build     # Build with tsup
npm run lint      # Type-check
```

## License

MIT

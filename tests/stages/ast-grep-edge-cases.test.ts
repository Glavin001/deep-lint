import { describe, it, expect } from "vitest";
import { createAstGrepStage } from "../../src/stages/ast-grep.js";
import type { Candidate } from "../../src/core/candidate.js";
import type { FileContext } from "../../src/types.js";

function makeSeedCandidate(fc: FileContext): Candidate {
  return {
    id: "",
    ruleId: "test-rule",
    location: {
      filePath: fc.filePath,
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 0,
    },
    matchedCode: "",
    metaVariables: {},
    annotations: {},
    filtered: false,
    fileContext: fc,
  };
}

describe("ast-grep edge cases", () => {
  it("extracts multiple metavariables from one pattern ($X = $Y)", () => {
    const fc: FileContext = {
      filePath: "multi-var.ts",
      content: "const foo = bar;\nconst baz = qux;\n",
      language: "typescript",
    };
    const stage = createAstGrepStage({ pattern: "const $X = $Y" });

    return stage.process([makeSeedCandidate(fc)], {}).then((results) => {
      expect(results.length).toBe(2);

      const firstVars = results[0].metaVariables;
      expect(firstVars.X).toBe("foo");
      expect(firstVars.Y).toBe("bar");

      const secondVars = results[1].metaVariables;
      expect(secondVars.X).toBe("baz");
      expect(secondVars.Y).toBe("qux");
    });
  });

  it("matches nested structures", async () => {
    const fc: FileContext = {
      filePath: "nested.ts",
      content: `
function outer() {
  if (true) {
    console.log("nested");
  }
}
`,
      language: "typescript",
    };
    const stage = createAstGrepStage({ pattern: "console.log($ARG)" });
    const results = await stage.process([makeSeedCandidate(fc)], {});

    expect(results).toHaveLength(1);
    expect(results[0].matchedCode).toContain("console.log");
    expect(results[0].metaVariables.ARG).toBe('"nested"');
  });

  it("works with JavaScript language (not TypeScript)", async () => {
    const fc: FileContext = {
      filePath: "app.js",
      content: 'var x = require("lodash");\nvar y = require("express");\n',
      language: "javascript",
    };
    const stage = createAstGrepStage({ pattern: "var $NAME = require($MOD)" });
    const results = await stage.process([makeSeedCandidate(fc)], {});

    expect(results.length).toBe(2);
    expect(results[0].metaVariables.NAME).toBe("x");
    expect(results[0].metaVariables.MOD).toBe('"lodash"');
    expect(results[1].metaVariables.NAME).toBe("y");
    expect(results[1].metaVariables.MOD).toBe('"express"');
  });

  it("returns no candidates for empty file content", async () => {
    const fc: FileContext = {
      filePath: "empty.ts",
      content: "",
      language: "typescript",
    };
    const stage = createAstGrepStage({ pattern: "console.log($$$ARGS)" });
    const results = await stage.process([makeSeedCandidate(fc)], {});

    expect(results).toHaveLength(0);
  });

  it("returns no candidates for whitespace-only file content", async () => {
    const fc: FileContext = {
      filePath: "whitespace.ts",
      content: "   \n\n   \n",
      language: "typescript",
    };
    const stage = createAstGrepStage({ pattern: "console.log($$$ARGS)" });
    const results = await stage.process([makeSeedCandidate(fc)], {});

    expect(results).toHaveLength(0);
  });

  it("returns no candidates when pattern has no matches", async () => {
    const fc: FileContext = {
      filePath: "clean.ts",
      content: "const x = 1;\nconst y = 2;\n",
      language: "typescript",
    };
    const stage = createAstGrepStage({ pattern: "console.log($$$ARGS)" });
    const results = await stage.process([makeSeedCandidate(fc)], {});

    expect(results).toHaveLength(0);
  });

  it("matches deeply nested callback patterns", async () => {
    const fc: FileContext = {
      filePath: "callbacks.ts",
      content: `
app.get("/api", (req, res) => {
  db.query("SELECT *", (err, rows) => {
    res.json(rows);
  });
});
`,
      language: "typescript",
    };
    const stage = createAstGrepStage({ pattern: "res.json($DATA)" });
    const results = await stage.process([makeSeedCandidate(fc)], {});

    expect(results).toHaveLength(1);
    expect(results[0].metaVariables.DATA).toBe("rows");
  });

  it("handles pattern with language override", async () => {
    // File says typescript but we override to javascript
    const fc: FileContext = {
      filePath: "test.js",
      content: 'var x = "hello";\n',
      language: "typescript",
    };
    const stage = createAstGrepStage({
      pattern: "var $NAME = $VAL",
      language: "javascript",
    });
    const results = await stage.process([makeSeedCandidate(fc)], {});

    expect(results.length).toBe(1);
    expect(results[0].metaVariables.NAME).toBe("x");
  });

  it("matches multiple occurrences on the same line", async () => {
    const fc: FileContext = {
      filePath: "sameline.ts",
      content: "const a = foo(1); const b = foo(2);\n",
      language: "typescript",
    };
    const stage = createAstGrepStage({ pattern: "foo($ARG)" });
    const results = await stage.process([makeSeedCandidate(fc)], {});

    expect(results.length).toBe(2);
    const args = results.map((r) => r.metaVariables.ARG).sort();
    expect(args).toEqual(["1", "2"]);
  });
});

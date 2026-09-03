import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vite-plus/test";
import { Language, Parser } from "web-tree-sitter";

import { sqlLanguageDefinition } from "../../../src/languages/sql/definition";
import type { ApplyChanges } from "../../../src/syntax/tree-sitter/protocol";
import { DocumentManager } from "../../../src/syntax/tree-sitter/worker/document-manager";
import { WorkerRuntime } from "../../../src/syntax/tree-sitter/worker/runtime";

const grammarUrl = new URL("../../../public/languages/sql/tree-sitter-sql.wasm", import.meta.url);
const treeSitterWasmUrl = new URL(
  "../../../node_modules/web-tree-sitter/tree-sitter.wasm",
  import.meta.url,
);

let parserInitPromise: Promise<void> | undefined;

function initializeParser(): Promise<void> {
  parserInitPromise ??= Parser.init({
    locateFile: (fileName: string) =>
      fileName === "tree-sitter.wasm" ? treeSitterWasmUrl.pathname : fileName,
  });
  return parserInitPromise;
}

function createManager(): { manager: DocumentManager; runtime: WorkerRuntime } {
  const runtime = new WorkerRuntime({
    parserInit: initializeParser,
    languageDependencies: {
      fetch: async () => new Response(await readFile(grammarUrl), { status: 200 }),
      loadLanguage: (bytes) => Language.load(bytes),
      createParser: () => new Parser(),
    },
  });
  runtime.registerLanguage(sqlLanguageDefinition);
  return { manager: new DocumentManager(runtime), runtime };
}

interface ParityCase {
  name: string;
  oldSource: string;
  newSource: string;
  changes: ApplyChanges["changes"];
  expectedChangedRanges?: Array<{
    start: { line: number; character: number };
    end: { line: number; character: number };
  }>;
}

const parityCases: ParityCase[] = [
  {
    name: "ASCII replacement",
    oldSource: "SELECT 1;",
    newSource: "SELECT 2;",
    changes: [{ rangeOffset: 7, rangeLength: 1, text: "2" }],
  },
  {
    name: "Chinese before replacement",
    oldSource: "SELECT '中x';",
    newSource: "SELECT '中y';",
    changes: [{ rangeOffset: 9, rangeLength: 1, text: "y" }],
  },
  {
    name: "emoji before replacement",
    oldSource: "SELECT '😀x';",
    newSource: "SELECT '😀y';",
    changes: [{ rangeOffset: 10, rangeLength: 1, text: "y" }],
  },
  {
    name: "mixed Unicode structural insert",
    oldSource: "SELECT '中😀x';",
    newSource: "SELECT '中😀x', y;",
    changes: [{ rangeOffset: 13, rangeLength: 0, text: ", y" }],
    expectedChangedRanges: [
      {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 16 },
      },
    ],
  },
  {
    name: "CRLF replacement",
    oldSource: "SELECT 1;\r\nSELECT 2;",
    newSource: "SELECT 1;\r\nSELECT 3;",
    changes: [{ rangeOffset: 18, rangeLength: 1, text: "3" }],
  },
  {
    name: "multiline replacement",
    oldSource: "SELECT 1;\nSELECT 2;",
    newSource: "SELECT 2;\nSELECT 3;",
    changes: [{ rangeOffset: 7, rangeLength: 11, text: "2;\nSELECT 3" }],
    expectedChangedRanges: [
      {
        start: { line: 0, character: 8 },
        end: { line: 1, character: 8 },
      },
    ],
  },
  {
    name: "delete",
    oldSource: "SELECT 1;",
    newSource: "SELECT ;",
    changes: [{ rangeOffset: 7, rangeLength: 1, text: "" }],
    expectedChangedRanges: [
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
    ],
  },
  {
    name: "insert",
    oldSource: "SELECT 1;",
    newSource: "-- note\nSELECT 1;",
    changes: [{ rangeOffset: 0, rangeLength: 0, text: "-- note\n" }],
    expectedChangedRanges: [
      {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 0 },
      },
    ],
  },
  {
    name: "representative batch edit",
    oldSource: "SELECT 1;\nSELECT 2;",
    newSource: "SELECT 3;\nSELECT 4;",
    changes: [
      { rangeOffset: 7, rangeLength: 1, text: "3" },
      { rangeOffset: 17, rangeLength: 1, text: "4" },
    ],
  },
];

describe("real SQL incremental parse parity", () => {
  it.each(parityCases)(
    "keeps the incremental tree equal to a full parse for $name",
    async (testCase) => {
      const { manager, runtime } = createManager();
      const documentUri = `file:///workspace/${testCase.name.replaceAll(" ", "-")}.sql`;
      let fullTree: ReturnType<Parser["parse"]> = null;

      try {
        const session = await manager.openDocument({
          documentUri,
          sessionId: `session-${testCase.name}`,
          documentVersion: 1,
          languageId: "sql",
          text: testCase.oldSource,
        });
        const result = await manager.applyChanges({
          type: "ApplyChanges",
          protocolVersion: 1,
          workerGeneration: 1,
          requestId: 1,
          sessionId: session.sessionId,
          documentUri,
          baseVersion: 1,
          nextVersion: 2,
          changes: testCase.changes,
        });
        const parser = await (await runtime.loadLanguage("sql")).getParser();
        fullTree = parser.parse(testCase.newSource);

        expect(session.textMirror).toBe(testCase.newSource);
        expect(session.tree.rootNode.toString()).toBe(fullTree?.rootNode.toString());
        expect(result.documentUri).toBe(documentUri);
        if (testCase.expectedChangedRanges !== undefined) {
          expect(result.changedRanges).toEqual(testCase.expectedChangedRanges);
        }
        for (const range of result.changedRanges) {
          const lines = testCase.newSource.split("\n").map((line) => line.replace(/\r$/, ""));
          expect(range.start.line).toBeGreaterThanOrEqual(0);
          expect(range.start.line).toBeLessThan(lines.length);
          expect(range.start.character).toBeLessThanOrEqual(lines[range.start.line]?.length ?? 0);
          expect(range.end.line).toBeGreaterThanOrEqual(0);
          expect(range.end.line).toBeLessThan(lines.length);
          expect(range.end.character).toBeLessThanOrEqual(lines[range.end.line]?.length ?? 0);
        }
      } finally {
        fullTree?.delete();
        manager.dispose();
        runtime.dispose();
      }
    },
  );
});

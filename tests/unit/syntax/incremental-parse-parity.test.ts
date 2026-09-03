import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vite-plus/test";
import { Language, Parser, Query } from "web-tree-sitter";

import { sqlLanguageDefinition } from "../../../src/languages/sql/definition";
import type { ApplyChanges, InspectNode } from "../../../src/syntax/tree-sitter/protocol";
import { DocumentManager } from "../../../src/syntax/tree-sitter/worker/document-manager";
import { collectFoldingRanges } from "../../../src/syntax/tree-sitter/worker/folding";
import { collectHighlightTokens } from "../../../src/syntax/tree-sitter/worker/highlight";
import { AstInspector } from "../../../src/syntax/tree-sitter/worker/inspector";
import { collectSelectionPath } from "../../../src/syntax/tree-sitter/worker/selection";
import { WorkerRuntime } from "../../../src/syntax/tree-sitter/worker/runtime";
import type { TextRange } from "../../../src/syntax/types";

const grammarUrl = new URL("../../../public/languages/sql/tree-sitter-sql.wasm", import.meta.url);
const treeSitterWasmUrl = new URL(
  "../../../node_modules/web-tree-sitter/tree-sitter.wasm",
  import.meta.url,
);
const highlightsQueryUrl = new URL(
  "../../../public/languages/sql/queries/highlights.scm",
  import.meta.url,
);
const foldsQueryUrl = new URL("../../../public/languages/sql/queries/folds.scm", import.meta.url);

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

function assertValidTextRange(text: string, range: TextRange): void {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  for (const position of [range.start, range.end]) {
    expect(position.line).toBeGreaterThanOrEqual(0);
    expect(position.line).toBeLessThan(lines.length);
    expect(position.character).toBeGreaterThanOrEqual(0);
    expect(position.character).toBeLessThanOrEqual(lines[position.line]?.length ?? 0);
  }
}

function assertValidInspectRanges(text: string, node: InspectNode): void {
  assertValidTextRange(text, node.range);
  for (const child of node.children) {
    assertValidInspectRanges(text, child);
  }
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

  it("maps actual CRLF SQL node ranges through highlight, inspector, and selection adapters", async () => {
    const { manager, runtime } = createManager();
    const source = "SELECT 1; -- comment\r\nSELECT 2;";
    let highlightsQuery: Query | undefined;
    let foldsQuery: Query | undefined;

    try {
      const session = await manager.openDocument({
        documentUri: "file:///workspace/crlf-range.sql",
        sessionId: "session-crlf-range",
        documentVersion: 1,
        languageId: "sql",
        text: source,
      });
      const language = await (await runtime.loadLanguage("sql")).load();
      highlightsQuery = new Query(language, await readFile(highlightsQueryUrl, "utf8"));
      foldsQuery = new Query(language, await readFile(foldsQueryUrl, "utf8"));

      const highlights = collectHighlightTokens(session, highlightsQuery);
      const comment = highlights.find((token) => token.type === "comment");
      expect(comment).toEqual({
        type: "comment",
        range: {
          start: { line: 0, character: 10 },
          end: { line: 0, character: 20 },
        },
      });
      for (const token of highlights) {
        assertValidTextRange(source, token.range);
      }

      const inspectResult = new AstInspector().inspect(session, {
        expectedVersion: 1,
        maxDepth: 20,
        maxNodes: 200,
      });
      expect(inspectResult.root?.range).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 1, character: 9 },
      });
      if (inspectResult.root !== null) {
        assertValidInspectRanges(source, inspectResult.root);
      }

      const foldingRanges = collectFoldingRanges(session, foldsQuery);
      for (const foldingRange of foldingRanges) {
        assertValidTextRange(source, foldingRange.range);
      }

      const selection = collectSelectionPath(session, { line: 0, character: 14 });
      expect(selection.ranges).toContainEqual({
        start: { line: 0, character: 10 },
        end: { line: 0, character: 20 },
      });
      for (const range of selection.ranges) {
        assertValidTextRange(source, range);
      }
    } finally {
      highlightsQuery?.delete();
      foldsQuery?.delete();
      manager.dispose();
      runtime.dispose();
    }
  });
});

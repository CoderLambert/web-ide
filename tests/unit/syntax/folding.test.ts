import { describe, expect, it } from "vite-plus/test";

import { collectFoldingRanges } from "../../../src/syntax/tree-sitter/worker/folding";
import type { DocumentSession } from "../../../src/syntax/tree-sitter/worker/document-session";
import type { Query, QueryCapture, Tree } from "web-tree-sitter";

function capture(
  name: string,
  startIndex: number,
  endIndex: number,
  startRow: number,
  endRow: number,
): QueryCapture {
  return {
    name,
    node: {
      text: "statement",
      startIndex,
      endIndex,
      startPosition: { row: startRow, column: 0 },
      endPosition: { row: endRow, column: 1 },
    },
  } as QueryCapture;
}

describe("SQL folding capture mapping", () => {
  it("filters single-line ranges, deduplicates captures, and keeps multiline ranges", () => {
    const session: DocumentSession = {
      documentUri: "opaque://query.sql",
      sessionId: "session-1",
      documentVersion: 1,
      languageId: "sql",
      textMirror: "SELECT 1;\nSELECT 2;\nSELECT 3;",
      tree: { rootNode: {} } as Tree,
      state: "ready",
    };
    const query = {
      captures: () => [
        capture("fold", 0, 9, 0, 0),
        capture("fold", 0, 21, 0, 1),
        capture("fold", 0, 21, 0, 1),
        capture("other", 22, 31, 2, 2),
      ],
    } as unknown as Query;

    expect(collectFoldingRanges(session, query)).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 1 },
        },
      },
    ]);
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  collectSelectionPath,
  textPositionToTreeSitterPoint,
} from "../../../src/syntax/tree-sitter/worker/selection";
import type { DocumentSession } from "../../../src/syntax/tree-sitter/worker/document-session";
import type { Node, Tree } from "web-tree-sitter";

function fakeNode(
  startColumn: number,
  endColumn: number,
  parent: Node | null,
  namedDescendant: Node,
): Node {
  return {
    startIndex: startColumn,
    endIndex: endColumn,
    startPosition: { row: 0, column: startColumn },
    endPosition: { row: 0, column: endColumn },
    parent,
    namedDescendantForPosition: () => namedDescendant,
  } as unknown as Node;
}

describe("Tree-sitter selection mapping", () => {
  it("retains UTF-16 columns for emoji and CRLF positions", () => {
    expect(textPositionToTreeSitterPoint("SELECT '😀', name", { line: 0, character: 13 })).toEqual({
      row: 0,
      column: 13,
    });
    expect(textPositionToTreeSitterPoint("SELECT\r\n  name", { line: 1, character: 2 })).toEqual({
      row: 1,
      column: 2,
    });
  });

  it("returns the smallest named node through its non-root parent chain", () => {
    const program = fakeNode(0, 23, null, {} as Node);
    const statement = fakeNode(0, 22, program, {} as Node);
    const select = fakeNode(0, 11, statement, {} as Node);
    const expression = fakeNode(7, 11, select, {} as Node);
    const term = fakeNode(7, 11, expression, {} as Node);
    const field = fakeNode(7, 11, term, {} as Node);
    const identifier = fakeNode(7, 11, field, {} as Node);
    const rootNode = {
      namedDescendantForPosition: () => identifier,
    } as unknown as Tree;
    const session: DocumentSession = {
      documentUri: "opaque://query.sql",
      sessionId: "session-1",
      documentVersion: 1,
      languageId: "sql",
      textMirror: "SELECT name FROM users;",
      tree: { rootNode } as unknown as Tree,
      state: "ready",
    };

    expect(collectSelectionPath(session, { line: 0, character: 8 })).toEqual({
      ranges: [
        { start: { line: 0, character: 7 }, end: { line: 0, character: 11 } },
        { start: { line: 0, character: 7 }, end: { line: 0, character: 11 } },
        { start: { line: 0, character: 7 }, end: { line: 0, character: 11 } },
        { start: { line: 0, character: 7 }, end: { line: 0, character: 11 } },
        { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } },
        { start: { line: 0, character: 0 }, end: { line: 0, character: 22 } },
      ],
    });
  });
});

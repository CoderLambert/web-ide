import { describe, expect, it } from "vite-plus/test";

import { collectHighlightTokens } from "../../../src/syntax/tree-sitter/worker/highlight";
import type { DocumentSession } from "../../../src/syntax/tree-sitter/worker/document-session";
import type { Query, QueryCapture, Tree } from "web-tree-sitter";

function node(
  text: string,
  startIndex: number,
  endIndex: number,
  startColumn: number,
  endColumn: number,
): QueryCapture["node"] {
  return {
    text,
    startIndex,
    endIndex,
    startPosition: { row: 0, column: startColumn },
    endPosition: { row: 0, column: endColumn },
  } as QueryCapture["node"];
}

function session(): DocumentSession {
  return {
    documentUri: "opaque://query.sql",
    sessionId: "session-1",
    documentVersion: 1,
    languageId: "sql",
    textMirror: "SELECT lower(123); -- comment",
    tree: { rootNode: {} } as Tree,
    state: "ready",
  };
}

describe("SQL highlight capture mapping", () => {
  it("maps project tokens and normalizes overlapping captures", () => {
    const numericNode = node("123", 13, 16, 13, 16);
    const functionNode = node("lower", 7, 12, 7, 12);
    const commentNode = node("-- comment", 19, 29, 19, 29);
    const unknownNode = node("ignored", 0, 7, 0, 7);
    const captures = [
      { name: "string", node: numericNode },
      { name: "number", node: numericNode },
      { name: "type", node: functionNode },
      { name: "function.call", node: functionNode },
      { name: "spell", node: commentNode },
      { name: "comment", node: commentNode },
      { name: "not-a-project-token", node: unknownNode },
    ] as QueryCapture[];
    const query = { captures: () => captures } as unknown as Query;

    expect(collectHighlightTokens(session(), query)).toEqual([
      {
        range: {
          start: { line: 0, character: 7 },
          end: { line: 0, character: 12 },
        },
        type: "function",
      },
      {
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 16 },
        },
        type: "number",
      },
      {
        range: {
          start: { line: 0, character: 19 },
          end: { line: 0, character: 29 },
        },
        type: "comment",
      },
    ]);
  });
});

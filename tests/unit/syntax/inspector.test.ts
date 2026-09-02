import { describe, expect, it } from "vite-plus/test";

import type { DocumentSession } from "../../../src/syntax/tree-sitter/worker/document-session";
import { AstInspector } from "../../../src/syntax/tree-sitter/worker/inspector";
import type { Node, Tree } from "web-tree-sitter";

interface FakeNode {
  type: string;
  isNamed: boolean;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  child(index: number): Node | null;
}

function node(
  type: string,
  startColumn: number,
  endColumn: number,
  children: FakeNode[] = [],
  isNamed = true,
): FakeNode {
  return {
    type,
    isNamed,
    startPosition: { row: 0, column: startColumn },
    endPosition: { row: 0, column: endColumn },
    childCount: children.length,
    child: (index) => (children[index] as unknown as Node | undefined) ?? null,
  };
}

function session(rootNode: FakeNode, overrides: Partial<DocumentSession> = {}): DocumentSession {
  return {
    documentUri: "opaque-document-id",
    sessionId: "session-1",
    documentVersion: 4,
    languageId: "sql",
    textMirror: "SELECT 1;",
    tree: { rootNode } as unknown as Tree,
    state: "ready",
    ...overrides,
  };
}

describe("AstInspector", () => {
  it("returns a serializable SQL-shaped AST with UTF-16 ranges", () => {
    const root = node("source_file", 0, 9, [
      node("select_statement", 0, 9, [node("SELECT", 0, 6, [], false), node("number", 7, 8)]),
    ]);

    const result = new AstInspector().inspect(session(root), {
      expectedVersion: 4,
      maxDepth: 10,
      maxNodes: 20,
    });

    expect(result).toEqual({
      root: {
        type: "source_file",
        isNamed: true,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 9 },
        },
        children: [
          {
            type: "select_statement",
            isNamed: true,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 9 },
            },
            children: [
              {
                type: "SELECT",
                isNamed: false,
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 6 },
                },
                children: [],
                truncated: false,
              },
              {
                type: "number",
                isNamed: true,
                range: {
                  start: { line: 0, character: 7 },
                  end: { line: 0, character: 8 },
                },
                children: [],
                truncated: false,
              },
            ],
            truncated: false,
          },
        ],
        truncated: false,
      },
      nodeCount: 4,
      truncated: false,
    });
  });

  it("enforces maxDepth and maxNodes without walking an unbounded tree", () => {
    const root = node("source_file", 0, 9, [
      node("statement", 0, 9, [node("expression", 0, 8)]),
      node("comment", 0, 0),
    ]);
    const inspector = new AstInspector();

    const depthLimited = inspector.inspect(session(root), {
      expectedVersion: 4,
      maxDepth: 1,
      maxNodes: 100,
    });
    expect(depthLimited.nodeCount).toBe(3);
    expect(depthLimited.truncated).toBe(true);
    expect(depthLimited.root?.children[0]?.truncated).toBe(true);

    const nodeLimited = inspector.inspect(session(root), {
      expectedVersion: 4,
      maxDepth: 100,
      maxNodes: 2,
    });
    expect(nodeLimited.nodeCount).toBe(2);
    expect(nodeLimited.truncated).toBe(true);
    expect(nodeLimited.root?.children).toHaveLength(1);
    expect(nodeLimited.root?.children[0]?.truncated).toBe(true);
  });

  it("rejects stale and desynced sessions before reading the tree", () => {
    const root = node("source_file", 0, 9);
    const inspector = new AstInspector();

    expect(() =>
      inspector.inspect(session(root), { expectedVersion: 3, maxDepth: 2, maxNodes: 10 }),
    ).toThrowError(expect.objectContaining({ code: "VERSION_MISMATCH" }));
    expect(() =>
      inspector.inspect(session(root, { state: "desynced" }), {
        expectedVersion: 4,
        maxDepth: 2,
        maxNodes: 10,
      }),
    ).toThrowError(expect.objectContaining({ code: "RESYNC_REQUIRED" }));
  });

  it("supports an empty node budget without returning an AST node", () => {
    const result = new AstInspector().inspect(session(node("source_file", 0, 9)), {
      expectedVersion: 4,
      maxDepth: 10,
      maxNodes: 0,
    });

    expect(result).toEqual({ root: null, nodeCount: 0, truncated: true });
  });
});

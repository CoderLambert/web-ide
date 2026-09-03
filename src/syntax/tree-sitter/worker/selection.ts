import type { Node, Point } from "web-tree-sitter";

import type { SyntaxSelectionPath, TextPosition } from "../../types";
import type { DocumentSession } from "./document-session";
import { treeSitterNodeToTextRange } from "./text-range";

function lineAt(text: string, row: number): string {
  let currentRow = 0;
  let lineStart = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text.charCodeAt(index) === 0x0a) {
      if (currentRow === row) {
        const line = text.slice(lineStart, index);
        return line.endsWith("\r") ? line.slice(0, -1) : line;
      }
      currentRow += 1;
      lineStart = index + 1;
    }
  }

  throw new Error(`Text position has an invalid line ${row}.`);
}

function validateUtf16Column(line: string, character: number): void {
  if (!Number.isInteger(character) || character < 0 || character > line.length) {
    throw new Error(`Text position has an invalid UTF-16 character ${character}.`);
  }
}

export function textPositionToTreeSitterPoint(text: string, position: TextPosition): Point {
  if (!Number.isInteger(position.line) || position.line < 0) {
    throw new Error(`Text position has an invalid line ${position.line}.`);
  }

  const line = lineAt(text, position.line);
  validateUtf16Column(line, position.character);
  return {
    row: position.line,
    column: position.character,
  };
}

function isRootNode(node: Node): boolean {
  return node.parent === null;
}

export function collectSelectionPath(
  session: DocumentSession,
  position: TextPosition,
): SyntaxSelectionPath {
  const point = textPositionToTreeSitterPoint(session.textMirror, position);
  let node = session.tree.rootNode.namedDescendantForPosition(point);
  const ranges = [];

  while (node !== null && !isRootNode(node)) {
    const range = treeSitterNodeToTextRange(session.textMirror, node);
    if (
      range.start.line < range.end.line ||
      (range.start.line === range.end.line && range.start.character < range.end.character)
    ) {
      ranges.push(range);
    }
    node = node.parent;
  }

  return { ranges };
}

export function collectSelectionPaths(
  session: DocumentSession,
  positions: readonly TextPosition[],
): SyntaxSelectionPath[] {
  return positions.map((position) => collectSelectionPath(session, position));
}

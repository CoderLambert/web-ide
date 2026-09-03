import type { Node, Point, Range } from "web-tree-sitter";

import type { TextPosition, TextRange } from "../../types";

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

  throw new Error(`Tree-sitter returned an invalid row ${row}.`);
}

export function treeSitterPositionToTextPosition(text: string, position: Point): TextPosition {
  if (!Number.isInteger(position.row) || position.row < 0) {
    throw new Error(`Tree-sitter returned an invalid row ${position.row}.`);
  }

  const line = lineAt(text, position.row);
  if (!Number.isInteger(position.column) || position.column < 0 || position.column > line.length) {
    throw new Error(`Tree-sitter returned an invalid UTF-16 column ${position.column}.`);
  }

  return {
    line: position.row,
    character: position.column,
  };
}

export function treeSitterRangeToTextRange(text: string, range: Range): TextRange {
  return {
    start: treeSitterPositionToTextPosition(text, range.startPosition),
    end: treeSitterPositionToTextPosition(text, range.endPosition),
  };
}

export function treeSitterNodeToTextRange(text: string, node: Node): TextRange {
  return treeSitterRangeToTextRange(text, node);
}

import type { Node, Point, Range } from "web-tree-sitter";

import type { TextPosition, TextRange } from "../../types";

const encoder = new TextEncoder();

function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

function lineAt(text: string, row: number): string {
  let currentRow = 0;
  let lineStart = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text.charCodeAt(index) === 0x0a) {
      if (currentRow === row) {
        return text.slice(lineStart, index);
      }
      currentRow += 1;
      lineStart = index + 1;
    }
  }

  throw new Error(`Tree-sitter returned an invalid row ${row}.`);
}

function utf8ColumnToUtf16(line: string, byteColumn: number): number {
  if (!Number.isInteger(byteColumn) || byteColumn < 0) {
    throw new Error(`Tree-sitter returned an invalid byte column ${byteColumn}.`);
  }

  let bytes = 0;
  let codeUnits = 0;
  while (codeUnits < line.length) {
    if (bytes === byteColumn) {
      return codeUnits;
    }

    const codePoint = line.codePointAt(codeUnits);
    if (codePoint === undefined) {
      break;
    }
    const codeUnitLength = codePoint > 0xffff ? 2 : 1;
    bytes += utf8ByteLength(line.slice(codeUnits, codeUnits + codeUnitLength));
    codeUnits += codeUnitLength;
    if (bytes > byteColumn) {
      throw new Error(`Tree-sitter returned a byte column inside a code point: ${byteColumn}.`);
    }
  }

  if (bytes === byteColumn) {
    return codeUnits;
  }
  throw new Error(`Tree-sitter returned a byte column outside the line: ${byteColumn}.`);
}

export function treeSitterPositionToTextPosition(text: string, position: Point): TextPosition {
  if (!Number.isInteger(position.row) || position.row < 0) {
    throw new Error(`Tree-sitter returned an invalid row ${position.row}.`);
  }

  return {
    line: position.row,
    character: utf8ColumnToUtf16(lineAt(text, position.row), position.column),
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

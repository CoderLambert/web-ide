import type { TextChange } from "./protocol";

export interface TreeSitterPoint {
  row: number;
  column: number;
}

export interface InputEdit {
  startPosition: TreeSitterPoint;
  oldEndPosition: TreeSitterPoint;
  newEndPosition: TreeSitterPoint;
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
}

export interface EncodedEditTransaction {
  stagedText: string;
  inputEdits: InputEdit[];
}

export class EditCodecError extends Error {
  readonly code = "INVALID_EDIT_TRANSACTION" as const;
}

function invalid(message: string): never {
  throw new EditCodecError(message);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isSurrogateSplit(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) {
    return false;
  }

  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

interface TextMetrics {
  byteOffsets: Uint32Array;
  lineStarts: number[];
}

function utf8ByteLength(text: string): number {
  let byteLength = 0;
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      invalid("Text contains an invalid code point.");
    }
    byteLength += utf8BytesForCodePoint(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return byteLength;
}

function utf8BytesForCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

function createTextMetrics(text: string): TextMetrics {
  const byteOffsets = new Uint32Array(text.length + 1);
  const lineStarts = [0];
  let byteOffset = 0;

  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      invalid("Text contains an invalid code point.");
    }

    const codeUnitLength = codePoint > 0xffff ? 2 : 1;
    byteOffset += utf8BytesForCodePoint(codePoint);
    for (let codeUnit = 1; codeUnit <= codeUnitLength; codeUnit += 1) {
      byteOffsets[index + codeUnit] = byteOffset;
    }
    if (codePoint === 0x0a) {
      lineStarts.push(index + codeUnitLength);
    }
    index += codeUnitLength;
  }

  return { byteOffsets, lineStarts };
}

function pointAtOffset(metrics: TextMetrics, offset: number): TreeSitterPoint {
  let low = 0;
  let high = metrics.lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((metrics.lineStarts[middle] ?? 0) <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const row = Math.max(0, low - 1);
  const lineStart = metrics.lineStarts[row] ?? 0;
  return { row, column: metrics.byteOffsets[offset] - metrics.byteOffsets[lineStart] };
}

function pointAfterText(start: TreeSitterPoint, text: string): TreeSitterPoint {
  let row = start.row;
  let column = start.column;

  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      invalid("Replacement text contains an invalid code point.");
    }

    const codeUnitLength = codePoint > 0xffff ? 2 : 1;
    if (codePoint === 0x0a) {
      row += 1;
      column = 0;
    } else {
      column += utf8BytesForCodePoint(codePoint);
    }
    index += codeUnitLength;
  }

  return { row, column };
}

function validateChanges(text: string, changes: readonly TextChange[]): TextChange[] {
  for (const change of changes) {
    if (
      change === null ||
      typeof change !== "object" ||
      !isInteger(change.rangeOffset) ||
      !isInteger(change.rangeLength) ||
      change.rangeOffset < 0 ||
      change.rangeLength < 0 ||
      typeof change.text !== "string"
    ) {
      invalid("A text change contains an invalid field.");
    }

    const end = change.rangeOffset + change.rangeLength;
    if (
      !Number.isSafeInteger(end) ||
      end > text.length ||
      isSurrogateSplit(text, change.rangeOffset) ||
      isSurrogateSplit(text, end)
    ) {
      invalid("A text change range is outside the UTF-16 text boundaries.");
    }
  }

  const sortedChanges = [...changes].sort((left, right) => right.rangeOffset - left.rangeOffset);
  for (let index = 1; index < sortedChanges.length; index += 1) {
    const higher = sortedChanges[index - 1];
    const lower = sortedChanges[index];
    if (lower.rangeOffset + lower.rangeLength > higher.rangeOffset) {
      invalid("Text changes must not overlap.");
    }
  }

  return sortedChanges;
}

export function encodeEditTransaction(
  text: string,
  changes: readonly TextChange[],
): EncodedEditTransaction {
  if (typeof text !== "string" || !Array.isArray(changes)) {
    invalid("An edit transaction requires text and a changes array.");
  }

  const sortedChanges = validateChanges(text, changes);
  if (sortedChanges.length === 0) {
    return { stagedText: text, inputEdits: [] };
  }

  let stagedText = text;
  const inputEdits: InputEdit[] = [];
  const metrics = createTextMetrics(text);

  for (const change of sortedChanges) {
    const startOffset = change.rangeOffset;
    const endOffset = startOffset + change.rangeLength;
    const startPosition = pointAtOffset(metrics, startOffset);
    const oldEndPosition = pointAtOffset(metrics, endOffset);
    const newEndPosition = pointAfterText(startPosition, change.text);
    const startIndex = metrics.byteOffsets[startOffset] ?? 0;
    const oldEndIndex = metrics.byteOffsets[endOffset] ?? startIndex;
    const newEndIndex = startIndex + utf8ByteLength(change.text);

    inputEdits.push({
      startPosition,
      oldEndPosition,
      newEndPosition,
      startIndex,
      oldEndIndex,
      newEndIndex,
    });
    stagedText = `${stagedText.slice(0, startOffset)}${change.text}${stagedText.slice(endOffset)}`;
  }

  return { stagedText, inputEdits };
}

export class EditCodec {
  encode(text: string, changes: readonly TextChange[]): EncodedEditTransaction {
    return encodeEditTransaction(text, changes);
  }
}

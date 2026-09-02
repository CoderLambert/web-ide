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

interface BoundaryMetric {
  byteIndex: number;
  position: TreeSitterPoint;
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

function measureBoundaries(text: string, offsets: readonly number[]): Map<number, BoundaryMetric> {
  const boundaries = [...new Set(offsets)].sort((left, right) => left - right);
  const metrics = new Map<number, BoundaryMetric>();
  let boundaryIndex = 0;
  let offset = 0;
  let byteIndex = 0;
  let row = 0;
  let column = 0;

  while (boundaryIndex < boundaries.length) {
    const boundary = boundaries[boundaryIndex];
    while (offset < boundary) {
      const codePoint = text.codePointAt(offset);
      if (codePoint === undefined) {
        invalid("Text contains an invalid code point.");
      }

      const codeUnitLength = codePoint > 0xffff ? 2 : 1;
      if (offset + codeUnitLength > boundary) {
        invalid("A text change boundary splits a code point.");
      }

      const byteLength = utf8BytesForCodePoint(codePoint);
      byteIndex += byteLength;
      if (codePoint === 0x0a) {
        row += 1;
        column = 0;
      } else {
        column += byteLength;
      }
      offset += codeUnitLength;
    }

    if (offset !== boundary) {
      invalid("A text change boundary is outside the UTF-16 text boundaries.");
    }

    metrics.set(boundary, { byteIndex, position: { row, column } });
    while (boundaries[boundaryIndex] === boundary) {
      boundaryIndex += 1;
    }
  }

  return metrics;
}

interface ReplacementMetrics {
  byteLength: number;
  endPosition: TreeSitterPoint;
}

function measureReplacement(start: TreeSitterPoint, text: string): ReplacementMetrics {
  let row = start.row;
  let column = start.column;
  let byteLength = 0;

  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      invalid("Replacement text contains an invalid code point.");
    }

    const codeUnitLength = codePoint > 0xffff ? 2 : 1;
    const currentByteLength = utf8BytesForCodePoint(codePoint);
    byteLength += currentByteLength;
    if (codePoint === 0x0a) {
      row += 1;
      column = 0;
    } else {
      column += currentByteLength;
    }
    index += codeUnitLength;
  }

  return { byteLength, endPosition: { row, column } };
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
  const metrics = measureBoundaries(
    text,
    sortedChanges.flatMap((change) => [
      change.rangeOffset,
      change.rangeOffset + change.rangeLength,
    ]),
  );

  for (const change of sortedChanges) {
    const startOffset = change.rangeOffset;
    const endOffset = startOffset + change.rangeLength;
    const startMetric = metrics.get(startOffset);
    const oldEndMetric = metrics.get(endOffset);
    if (startMetric === undefined || oldEndMetric === undefined) {
      invalid("A text change boundary could not be measured.");
    }
    const replacement = measureReplacement(startMetric.position, change.text);

    inputEdits.push({
      startPosition: startMetric.position,
      oldEndPosition: oldEndMetric.position,
      newEndPosition: replacement.endPosition,
      startIndex: startMetric.byteIndex,
      oldEndIndex: oldEndMetric.byteIndex,
      newEndIndex: startMetric.byteIndex + replacement.byteLength,
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

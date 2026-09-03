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
  position: TreeSitterPoint;
}

function measureBoundaries(text: string, offsets: readonly number[]): Map<number, BoundaryMetric> {
  const boundaries = [...new Set(offsets)].sort((left, right) => left - right);
  const metrics = new Map<number, BoundaryMetric>();
  let offset = 0;
  let row = 0;
  let column = 0;

  for (const boundary of boundaries) {
    while (offset < boundary) {
      if (text.charCodeAt(offset) === 0x0a) {
        row += 1;
        column = 0;
      } else {
        column += 1;
      }
      offset += 1;
    }

    metrics.set(boundary, { position: { row, column } });
  }

  return metrics;
}

interface ReplacementMetrics {
  endPosition: TreeSitterPoint;
}

function measureReplacement(start: TreeSitterPoint, text: string): ReplacementMetrics {
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline < 0) {
    return {
      endPosition: {
        row: start.row,
        column: start.column + text.length,
      },
    };
  }

  return {
    endPosition: {
      row: start.row + (text.match(/\n/g)?.length ?? 0),
      column: text.length - lastNewline - 1,
    },
  };
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
      startIndex: startOffset,
      oldEndIndex: endOffset,
      newEndIndex: startOffset + change.text.length,
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

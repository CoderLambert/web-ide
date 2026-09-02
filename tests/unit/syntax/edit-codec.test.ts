import { describe, expect, it } from "vite-plus/test";

import {
  EditCodec,
  encodeEditTransaction,
  EditCodecError,
} from "../../../src/syntax/tree-sitter/edit-codec";
import type { InputEdit, TreeSitterPoint } from "../../../src/syntax/tree-sitter/edit-codec";

interface ReferenceTextMetrics {
  byteOffsets: Uint32Array;
  lineStarts: number[];
}

function referenceUtf8BytesForCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function referenceCreateTextMetrics(text: string): ReferenceTextMetrics {
  const byteOffsets = new Uint32Array(text.length + 1);
  const lineStarts = [0];
  let byteOffset = 0;
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      throw new Error("Reference replacement contains an invalid code point.");
    }
    const codeUnitLength = codePoint > 0xffff ? 2 : 1;
    byteOffset += referenceUtf8BytesForCodePoint(codePoint);
    for (let codeUnit = 1; codeUnit <= codeUnitLength; codeUnit += 1) {
      byteOffsets[index + codeUnit] = byteOffset;
    }
    if (codePoint === 0x0a) lineStarts.push(index + codeUnitLength);
    index += codeUnitLength;
  }
  return { byteOffsets, lineStarts };
}

function referencePointAtOffset(metrics: ReferenceTextMetrics, offset: number): TreeSitterPoint {
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

function referencePointAfterText(start: TreeSitterPoint, text: string): TreeSitterPoint {
  let row = start.row;
  let column = start.column;

  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      throw new Error("Reference replacement contains an invalid code point.");
    }
    const codeUnitLength = codePoint > 0xffff ? 2 : 1;
    const byteLength = referenceUtf8BytesForCodePoint(codePoint);
    if (codePoint === 0x0a) {
      row += 1;
      column = 0;
    } else {
      column += byteLength;
    }
    index += codeUnitLength;
  }

  return { row, column };
}

function referenceUtf8ByteLength(text: string): number {
  let byteLength = 0;
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      throw new Error("Reference text contains an invalid code point.");
    }
    byteLength += referenceUtf8BytesForCodePoint(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return byteLength;
}

function referenceEncodeEditTransaction(
  text: string,
  changes: readonly { rangeOffset: number; rangeLength: number; text: string }[],
): { stagedText: string; inputEdits: InputEdit[] } {
  const sortedChanges = [...changes].sort((left, right) => right.rangeOffset - left.rangeOffset);
  let stagedText = text;
  const inputEdits: InputEdit[] = [];
  const metrics = referenceCreateTextMetrics(text);

  for (const change of sortedChanges) {
    const startOffset = change.rangeOffset;
    const endOffset = startOffset + change.rangeLength;
    const startPosition = referencePointAtOffset(metrics, startOffset);
    const oldEndPosition = referencePointAtOffset(metrics, endOffset);
    const newEndPosition = referencePointAfterText(startPosition, change.text);
    const startIndex = referenceUtf8ByteLength(text.slice(0, startOffset));
    const oldEndIndex = referenceUtf8ByteLength(text.slice(0, endOffset));

    inputEdits.push({
      startPosition,
      oldEndPosition,
      newEndPosition,
      startIndex,
      oldEndIndex,
      newEndIndex: startIndex + referenceUtf8ByteLength(change.text),
    });
    stagedText = `${stagedText.slice(0, startOffset)}${change.text}${stagedText.slice(endOffset)}`;
  }

  return { stagedText, inputEdits };
}

function largeAsciiSource(): string {
  return `a${"x".repeat(1024 * 1024 - 2)}z`;
}

describe("EditCodec", () => {
  it.each([
    {
      name: "ASCII insert",
      source: "abcd",
      changes: [{ rangeOffset: 2, rangeLength: 0, text: "XY" }],
      expectedText: "abXYcd",
    },
    {
      name: "Unicode replace",
      source: "a中文😀b",
      changes: [{ rangeOffset: 1, rangeLength: 4, text: "世界" }],
      expectedText: "a世界b",
    },
    {
      name: "multiline insert",
      source: "SELECT 1;\nSELECT 2;",
      changes: [{ rangeOffset: 9, rangeLength: 0, text: "中文\n" }],
      expectedText: "SELECT 1;中文\n\nSELECT 2;",
    },
    {
      name: "CRLF delete",
      source: "one\r\ntwo",
      changes: [{ rangeOffset: 3, rangeLength: 2, text: "" }],
      expectedText: "onetwo",
    },
    {
      name: "replace representative undo/redo edit",
      source: "SELECT old;",
      changes: [{ rangeOffset: 7, rangeLength: 3, text: "new" }],
      expectedText: "SELECT new;",
    },
  ])("encodes $name", ({ source, changes, expectedText }) => {
    const transaction = encodeEditTransaction(source, changes);

    expect(transaction.stagedText).toBe(expectedText);
    expect(transaction.inputEdits).toHaveLength(1);
    for (const edit of transaction.inputEdits) {
      expect(edit.startIndex).toBeLessThanOrEqual(edit.oldEndIndex);
      expect(edit.startIndex).toBeLessThanOrEqual(edit.newEndIndex);
      expect(edit.startPosition.row).toBeGreaterThanOrEqual(0);
      expect(edit.startPosition.column).toBeGreaterThanOrEqual(0);
      expect(edit.oldEndPosition.row).toBeGreaterThanOrEqual(0);
      expect(edit.oldEndPosition.column).toBeGreaterThanOrEqual(0);
      expect(edit.newEndPosition.row).toBeGreaterThanOrEqual(0);
      expect(edit.newEndPosition.column).toBeGreaterThanOrEqual(0);
    }
  });

  it("encodes non-overlapping batch and multi-cursor changes atomically", () => {
    const transaction = encodeEditTransaction("0123456789", [
      { rangeOffset: 1, rangeLength: 2, text: "A" },
      { rangeOffset: 7, rangeLength: 1, text: "BC" },
      { rangeOffset: 4, rangeLength: 0, text: "X" },
    ]);

    expect(transaction.stagedText).toBe("0A3X456BC89");
    expect(transaction.inputEdits).toHaveLength(3);
    expect(transaction.inputEdits[0]?.startIndex).toBe(7);
    expect(transaction.inputEdits[1]?.startIndex).toBe(4);
    expect(transaction.inputEdits[2]?.startIndex).toBe(1);
  });

  it("keeps original UTF-8 positions for a Unicode batch transaction", () => {
    const transaction = encodeEditTransaction("前😀 middle\n尾", [
      { rangeOffset: 1, rangeLength: 2, text: "后" },
      { rangeOffset: 9, rangeLength: 1, text: "终" },
    ]);

    expect(transaction.stagedText).toBe("前后 middl终\n尾");
    expect(transaction.inputEdits).toMatchObject([
      {
        startPosition: { row: 0, column: 13 },
        oldEndPosition: { row: 0, column: 14 },
        newEndPosition: { row: 0, column: 16 },
      },
      {
        startPosition: { row: 0, column: 3 },
        oldEndPosition: { row: 0, column: 7 },
        newEndPosition: { row: 0, column: 6 },
      },
    ]);
  });

  it("uses UTF-8 byte columns while retaining UTF-16 input offsets", () => {
    const transaction = new EditCodec().encode("中😀x", [
      { rangeOffset: 3, rangeLength: 1, text: "y" },
    ]);

    expect(transaction.stagedText).toBe("中😀y");
    expect(transaction.inputEdits[0]).toMatchObject({
      startPosition: { row: 0, column: 7 },
      oldEndPosition: { row: 0, column: 8 },
      newEndPosition: { row: 0, column: 8 },
      startIndex: 7,
      oldEndIndex: 8,
      newEndIndex: 8,
    });
  });

  it.each([
    {
      name: "ASCII start insert",
      source: "abcdef",
      changes: [{ rangeOffset: 0, rangeLength: 0, text: "X" }],
    },
    {
      name: "ASCII middle replace",
      source: "abcdef",
      changes: [{ rangeOffset: 2, rangeLength: 2, text: "XY" }],
    },
    {
      name: "ASCII end delete",
      source: "abcdef",
      changes: [{ rangeOffset: 5, rangeLength: 1, text: "" }],
    },
    {
      name: "CJK and emoji replacement",
      source: "前😀中后",
      changes: [{ rangeOffset: 1, rangeLength: 3, text: "世界🚀" }],
    },
    {
      name: "CRLF multiline replacement",
      source: "one\r\ntwo\r\nthree",
      changes: [{ rangeOffset: 3, rangeLength: 5, text: "一\n二\r\n" }],
    },
    {
      name: "batch with shared boundaries",
      source: "abc😀\n中文",
      changes: [
        { rangeOffset: 0, rangeLength: 1, text: "A" },
        { rangeOffset: 1, rangeLength: 2, text: "🚀" },
        { rangeOffset: 3, rangeLength: 2, text: "" },
      ],
    },
  ])("matches the dense reference for $name", ({ source, changes }) => {
    expect(encodeEditTransaction(source, changes)).toEqual(
      referenceEncodeEditTransaction(source, changes),
    );
  });

  it.each([
    { name: "start", offset: 0 },
    { name: "middle", offset: Math.floor((1024 * 1024) / 2) },
    { name: "end", offset: 1024 * 1024 - 1 },
  ])("matches the dense reference for a 1MB $name edit", ({ offset }) => {
    const source = largeAsciiSource();
    const changes = [{ rangeOffset: offset, rangeLength: 1, text: "q" }];

    expect(encodeEditTransaction(source, changes)).toEqual(
      referenceEncodeEditTransaction(source, changes),
    );
  });

  it("rejects out-of-bounds, overlapping, and surrogate-splitting changes", () => {
    const invalidTransactions = [
      () => encodeEditTransaction("abc", [{ rangeOffset: 4, rangeLength: 0, text: "x" }]),
      () =>
        encodeEditTransaction("abc", [
          { rangeOffset: 0, rangeLength: 2, text: "x" },
          { rangeOffset: 1, rangeLength: 1, text: "y" },
        ]),
      () => encodeEditTransaction("😀", [{ rangeOffset: 1, rangeLength: 0, text: "x" }]),
      () => encodeEditTransaction("abc", [null as never]),
    ];

    for (const invalidTransaction of invalidTransactions) {
      expect(invalidTransaction).toThrow(EditCodecError);
    }
  });

  it("leaves an empty transaction unchanged", () => {
    expect(encodeEditTransaction("中文\r\n😀", [])).toEqual({
      stagedText: "中文\r\n😀",
      inputEdits: [],
    });
  });
});

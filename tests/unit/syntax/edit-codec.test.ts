import { describe, expect, it } from "vite-plus/test";

import {
  EditCodec,
  encodeEditTransaction,
  EditCodecError,
} from "../../../src/syntax/tree-sitter/edit-codec";

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
      expectedEdit: {
        startPosition: { row: 0, column: 2 },
        oldEndPosition: { row: 0, column: 2 },
        newEndPosition: { row: 0, column: 4 },
        startIndex: 2,
        oldEndIndex: 2,
        newEndIndex: 4,
      },
    },
    {
      name: "Unicode replace",
      source: "a中文😀b",
      changes: [{ rangeOffset: 1, rangeLength: 4, text: "世界" }],
      expectedText: "a世界b",
      expectedEdit: {
        startPosition: { row: 0, column: 1 },
        oldEndPosition: { row: 0, column: 5 },
        newEndPosition: { row: 0, column: 3 },
        startIndex: 1,
        oldEndIndex: 5,
        newEndIndex: 3,
      },
    },
    {
      name: "multiline insert",
      source: "SELECT 1;\nSELECT 2;",
      changes: [{ rangeOffset: 9, rangeLength: 0, text: "中文\n" }],
      expectedText: "SELECT 1;中文\n\nSELECT 2;",
      expectedEdit: {
        startPosition: { row: 0, column: 9 },
        oldEndPosition: { row: 0, column: 9 },
        newEndPosition: { row: 1, column: 0 },
        startIndex: 9,
        oldEndIndex: 9,
        newEndIndex: 12,
      },
    },
    {
      name: "CRLF delete",
      source: "one\r\ntwo",
      changes: [{ rangeOffset: 3, rangeLength: 2, text: "" }],
      expectedText: "onetwo",
      expectedEdit: {
        startPosition: { row: 0, column: 3 },
        oldEndPosition: { row: 1, column: 0 },
        newEndPosition: { row: 0, column: 3 },
        startIndex: 3,
        oldEndIndex: 5,
        newEndIndex: 3,
      },
    },
    {
      name: "replace representative undo/redo edit",
      source: "SELECT old;",
      changes: [{ rangeOffset: 7, rangeLength: 3, text: "new" }],
      expectedText: "SELECT new;",
      expectedEdit: {
        startPosition: { row: 0, column: 7 },
        oldEndPosition: { row: 0, column: 10 },
        newEndPosition: { row: 0, column: 10 },
        startIndex: 7,
        oldEndIndex: 10,
        newEndIndex: 10,
      },
    },
  ])("encodes $name", ({ source, changes, expectedText, expectedEdit }) => {
    const transaction = encodeEditTransaction(source, changes);

    expect(transaction.stagedText).toBe(expectedText);
    expect(transaction.inputEdits).toHaveLength(1);
    expect(transaction.inputEdits[0]).toEqual(expectedEdit);
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

  it("keeps original UTF-16 positions for a Unicode batch transaction", () => {
    const transaction = encodeEditTransaction("前😀 middle\n尾", [
      { rangeOffset: 1, rangeLength: 2, text: "后" },
      { rangeOffset: 9, rangeLength: 1, text: "终" },
    ]);

    expect(transaction.stagedText).toBe("前后 middl终\n尾");
    expect(transaction.inputEdits).toMatchObject([
      {
        startPosition: { row: 0, column: 9 },
        oldEndPosition: { row: 0, column: 10 },
        newEndPosition: { row: 0, column: 10 },
        startIndex: 9,
        oldEndIndex: 10,
        newEndIndex: 10,
      },
      {
        startPosition: { row: 0, column: 1 },
        oldEndPosition: { row: 0, column: 3 },
        newEndPosition: { row: 0, column: 2 },
        startIndex: 1,
        oldEndIndex: 3,
        newEndIndex: 2,
      },
    ]);
  });

  it("uses UTF-16 code-unit indices and columns for mixed Unicode text", () => {
    const transaction = new EditCodec().encode("中😀x", [
      { rangeOffset: 3, rangeLength: 1, text: "y" },
    ]);

    expect(transaction.stagedText).toBe("中😀y");
    expect(transaction.inputEdits[0]).toMatchObject({
      startPosition: { row: 0, column: 3 },
      oldEndPosition: { row: 0, column: 4 },
      newEndPosition: { row: 0, column: 4 },
      startIndex: 3,
      oldEndIndex: 4,
      newEndIndex: 4,
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
  ])("uses UTF-16 coordinates for $name", ({ source, changes }) => {
    const transaction = encodeEditTransaction(source, changes);
    expect(transaction.stagedText).toBe(
      changes
        .slice()
        .sort((left, right) => right.rangeOffset - left.rangeOffset)
        .reduce(
          (stagedText, change) =>
            `${stagedText.slice(0, change.rangeOffset)}${change.text}${stagedText.slice(
              change.rangeOffset + change.rangeLength,
            )}`,
          source,
        ),
    );
    expect(transaction.inputEdits.every((edit) => edit.startIndex >= 0)).toBe(true);
  });

  it.each([
    { name: "start", offset: 0 },
    { name: "middle", offset: Math.floor((1024 * 1024) / 2) },
    { name: "end", offset: 1024 * 1024 - 1 },
  ])("preserves UTF-16 offsets for a 1MB $name edit", ({ offset }) => {
    const source = largeAsciiSource();
    const changes = [{ rangeOffset: offset, rangeLength: 1, text: "q" }];

    const transaction = encodeEditTransaction(source, changes);
    expect(transaction.inputEdits[0]).toMatchObject({
      startIndex: offset,
      oldEndIndex: offset + 1,
      newEndIndex: offset + 1,
      startPosition: { row: 0, column: offset },
      oldEndPosition: { row: 0, column: offset + 1 },
      newEndPosition: { row: 0, column: offset + 1 },
    });
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

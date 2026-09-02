import { describe, expect, it } from "vite-plus/test";

import {
  EditCodec,
  encodeEditTransaction,
  EditCodecError,
} from "../../../src/syntax/tree-sitter/edit-codec";

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

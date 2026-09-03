import { describe, expect, it } from "vite-plus/test";

import {
  PROTOCOL_VERSION,
  decodeWorkerMessage,
  isProtocolMessage,
  ProtocolDecodeError,
  type ProtocolMessage,
} from "../../../src/syntax/tree-sitter/protocol";

const requestMeta = {
  protocolVersion: PROTOCOL_VERSION,
  workerGeneration: 3,
  requestId: 7,
  sessionId: "session-1",
  documentUri: "not-a-url-but-an-opaque-id",
};

const fixtures: ProtocolMessage[] = [
  {
    type: "OpenDocument",
    ...requestMeta,
    documentVersion: 11,
    languageId: "sql",
    text: "SELECT 1;",
  },
  {
    type: "ApplyChanges",
    ...requestMeta,
    baseVersion: 11,
    nextVersion: 12,
    changes: [{ rangeOffset: 7, rangeLength: 1, text: "2" }],
  },
  {
    type: "ReplaceDocument",
    ...requestMeta,
    documentVersion: 12,
    text: "SELECT 2;",
  },
  {
    type: "CloseDocument",
    ...requestMeta,
    documentVersion: 12,
  },
  {
    type: "InspectDocument",
    ...requestMeta,
    expectedVersion: 12,
    maxDepth: 8,
    maxNodes: 2000,
  },
  {
    type: "GetHighlights",
    ...requestMeta,
    expectedVersion: 12,
  },
  {
    type: "GetFoldingRanges",
    ...requestMeta,
    expectedVersion: 12,
  },
  {
    type: "GetSelectionRanges",
    ...requestMeta,
    expectedVersion: 12,
    positions: [{ line: 0, character: 1 }],
  },
  {
    type: "WorkerReady",
    protocolVersion: PROTOCOL_VERSION,
    workerGeneration: 3,
  },
  {
    type: "ParseResult",
    ...requestMeta,
    documentVersion: 12,
    parseTimeMs: 1.5,
    hasErrors: false,
    changedRanges: [
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 8 },
      },
    ],
  },
  {
    type: "InspectResult",
    ...requestMeta,
    documentVersion: 12,
    root: {
      type: "source_file",
      isNamed: true,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 9 },
      },
      children: [],
      truncated: false,
    },
    nodeCount: 1,
    truncated: false,
  },
  {
    type: "HighlightsResult",
    ...requestMeta,
    documentVersion: 12,
    tokens: [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 6 },
        },
        type: "keyword",
      },
    ],
  },
  {
    type: "FoldingRangesResult",
    ...requestMeta,
    documentVersion: 12,
    ranges: [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 2, character: 1 },
        },
      },
    ],
  },
  {
    type: "SelectionRangesResult",
    ...requestMeta,
    documentVersion: 12,
    selections: [
      {
        ranges: [
          {
            start: { line: 0, character: 7 },
            end: { line: 0, character: 9 },
          },
        ],
      },
    ],
  },
  {
    type: "WorkerError",
    protocolVersion: PROTOCOL_VERSION,
    workerGeneration: 3,
    requestId: 7,
    code: "VERSION_MISMATCH",
    message: "Document version does not match the worker mirror.",
    sessionId: requestMeta.sessionId,
    documentUri: requestMeta.documentUri,
    documentVersion: 12,
  },
];

describe("Tree-sitter Worker protocol", () => {
  it.each(fixtures)("accepts a valid $type message", (fixture) => {
    expect(decodeWorkerMessage(fixture)).toEqual(fixture);
    expect(isProtocolMessage(fixture)).toBe(true);
  });

  it("rejects unknown input, missing fields, and invalid fields", () => {
    const invalidInputs: unknown[] = [
      null,
      [],
      { type: "OpenDocument" },
      { ...fixtures[0], requestId: "7" },
      { ...fixtures[1], changes: [{ rangeOffset: -1, rangeLength: 0, text: "" }] },
      { ...fixtures[2], documentUri: "" },
      { ...fixtures[4], maxNodes: "2000" },
      { ...fixtures[5], workerGeneration: -1 },
      { ...fixtures[9], changedRanges: [{ start: { line: 0, character: 0 } }] },
      { ...fixtures[10], root: { type: "source_file" } },
      { ...fixtures[11], tokens: [{ range: {}, type: "keyword" }] },
      { ...fixtures[12], ranges: [{ range: {}, extra: true }] },
      { ...fixtures[13], selections: [{ ranges: [{}, {}] }] },
      { ...fixtures[14], code: "NOT_A_REAL_ERROR" },
      { ...fixtures[7], positions: [{ line: 0, character: -1 }] },
      {
        ...fixtures[11],
        tokens: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 6 },
            },
            type: "raw.capture",
          },
        ],
      },
      { ...fixtures[0], unexpected: true },
      { type: "NotAProtocolMessage", protocolVersion: PROTOCOL_VERSION },
    ];

    for (const input of invalidInputs) {
      expect(() => decodeWorkerMessage(input)).toThrow(ProtocolDecodeError);
      expect(isProtocolMessage(input)).toBe(false);
    }
  });

  it("rejects a protocol version mismatch with a distinct error code", () => {
    const input = { ...fixtures[0], protocolVersion: PROTOCOL_VERSION + 1 };

    expect(() => decodeWorkerMessage(input)).toThrowError(
      expect.objectContaining({ code: "PROTOCOL_MISMATCH" }),
    );
  });

  it("rejects malformed or cyclic Inspector result DTOs", () => {
    expect(() => decodeWorkerMessage({ ...fixtures[10], nodeCount: 2 })).toThrow(
      ProtocolDecodeError,
    );

    const cyclicNode: Record<string, unknown> = {
      type: "source_file",
      isNamed: true,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      children: [],
      truncated: false,
    };
    cyclicNode.children = [cyclicNode];
    expect(() => decodeWorkerMessage({ ...fixtures[10], root: cyclicNode, nodeCount: 2 })).toThrow(
      ProtocolDecodeError,
    );
  });

  it("keeps ApplyChanges version semantics explicit", () => {
    const decoded = decodeWorkerMessage(fixtures[1]);

    expect(decoded).toMatchObject({
      type: "ApplyChanges",
      baseVersion: 11,
      nextVersion: 12,
    });
    expect(decoded).not.toHaveProperty("documentVersion");
  });

  it("keeps Inspector expected version separate from its response version", () => {
    const decoded = decodeWorkerMessage(fixtures[4]);

    expect(decoded).toMatchObject({ type: "InspectDocument", expectedVersion: 12 });
    expect(decoded).not.toHaveProperty("documentVersion");
  });

  it("keeps capability request expected versions separate from result versions", () => {
    const request = decodeWorkerMessage(fixtures[5]);
    const result = decodeWorkerMessage(fixtures[11]);

    expect(request).toMatchObject({ type: "GetHighlights", expectedVersion: 12 });
    expect(request).not.toHaveProperty("documentVersion");
    expect(result).toMatchObject({ type: "HighlightsResult", documentVersion: 12 });
  });
});

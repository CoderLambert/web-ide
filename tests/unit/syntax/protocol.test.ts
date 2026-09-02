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
    documentVersion: 12,
    maxDepth: 8,
    maxNodes: 2000,
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
      { ...fixtures[6], changedRanges: [{ start: { line: 0, character: 0 } }] },
      { ...fixtures[7], code: "NOT_A_REAL_ERROR" },
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

  it("keeps ApplyChanges version semantics explicit", () => {
    const decoded = decodeWorkerMessage(fixtures[1]);

    expect(decoded).toMatchObject({
      type: "ApplyChanges",
      baseVersion: 11,
      nextVersion: 12,
    });
    expect(decoded).not.toHaveProperty("documentVersion");
  });
});

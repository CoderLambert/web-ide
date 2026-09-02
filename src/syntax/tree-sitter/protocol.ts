export const PROTOCOL_VERSION = 1 as const;

export const PROTOCOL_MESSAGE_TYPES = [
  "OpenDocument",
  "ApplyChanges",
  "ReplaceDocument",
  "CloseDocument",
  "InspectDocument",
  "WorkerReady",
  "ParseResult",
  "WorkerError",
] as const;

export type ProtocolMessageType = (typeof PROTOCOL_MESSAGE_TYPES)[number];

export const WORKER_ERROR_CODES = [
  "INVALID_MESSAGE",
  "PROTOCOL_MISMATCH",
  "UNKNOWN_LANGUAGE",
  "DOCUMENT_ALREADY_OPEN",
  "SESSION_NOT_FOUND",
  "VERSION_MISMATCH",
  "RESYNC_REQUIRED",
  "LANGUAGE_LOAD_FAILED",
  "PARSE_FAILED",
  "INTERNAL_ERROR",
] as const;

export type WorkerErrorCode = (typeof WORKER_ERROR_CODES)[number];

/** Shared project DTO; line and character are both 0-based UTF-16 offsets. */
export interface TextPosition {
  line: number;
  character: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

/** Text changes use UTF-16 offsets and never carry editor-specific range objects. */
export interface TextChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

/** protocolVersion is shared; workerGeneration is assigned by WorkerSupervisor. */
export interface RequestMeta {
  protocolVersion: typeof PROTOCOL_VERSION;
  workerGeneration: number;
  /** requestId is allocated by TreeSitterClient and echoed by the Worker. */
  requestId: number;
}

/** sessionId belongs to a document-binding lifetime; documentUri is opaque identity only. */
export interface DocumentMeta {
  sessionId: string;
  documentUri: string;
}

export interface VersionedDocumentMeta extends DocumentMeta {
  /** documentVersion is owned by the editor model. */
  documentVersion: number;
}

export interface OpenDocument extends RequestMeta, VersionedDocumentMeta {
  type: "OpenDocument";
  languageId: string;
  text: string;
}

export interface ApplyChanges extends RequestMeta, DocumentMeta {
  type: "ApplyChanges";
  /** The worker must apply this transaction only to baseVersion. */
  baseVersion: number;
  /** The model version represented after all changes in this transaction. */
  nextVersion: number;
  changes: TextChange[];
}

export interface ReplaceDocument extends RequestMeta, VersionedDocumentMeta {
  type: "ReplaceDocument";
  text: string;
}

export interface CloseDocument extends RequestMeta, VersionedDocumentMeta {
  type: "CloseDocument";
}

export interface InspectDocument extends RequestMeta, VersionedDocumentMeta {
  type: "InspectDocument";
  maxDepth: number;
  maxNodes: number;
}

/** WorkerSupervisor owns the generation; readiness is not tied to a document request. */
export interface WorkerReady {
  type: "WorkerReady";
  protocolVersion: typeof PROTOCOL_VERSION;
  workerGeneration: number;
}

export interface ParseResult extends RequestMeta, VersionedDocumentMeta {
  type: "ParseResult";
  parseTimeMs: number;
  hasErrors: boolean;
  changedRanges: TextRange[];
}

export interface WorkerError {
  type: "WorkerError";
  protocolVersion: typeof PROTOCOL_VERSION;
  workerGeneration: number;
  /** Null means the Worker could not associate the error with a client request. */
  requestId: number | null;
  code: WorkerErrorCode;
  message: string;
  sessionId?: string;
  documentUri?: string;
  documentVersion?: number;
}

export type DocumentMessage = OpenDocument | ApplyChanges | ReplaceDocument | CloseDocument;

export type WorkerRequest =
  | OpenDocument
  | ApplyChanges
  | ReplaceDocument
  | CloseDocument
  | InspectDocument;

export type WorkerResponse = WorkerReady | ParseResult | WorkerError;

export type ProtocolMessage = WorkerRequest | WorkerResponse;

export class ProtocolDecodeError extends Error {
  readonly code: "INVALID_MESSAGE" | "PROTOCOL_MISMATCH";
  readonly path: string | undefined;

  constructor(code: "INVALID_MESSAGE" | "PROTOCOL_MISMATCH", message: string, path?: string) {
    super(message);
    this.name = "ProtocolDecodeError";
    this.code = code;
    this.path = path;
  }
}

type MessageRecord = Record<string, unknown>;

const hasOwn = (record: MessageRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const invalid = (message: string, path?: string): never => {
  throw new ProtocolDecodeError("INVALID_MESSAGE", message, path);
};

const expectRecord = (input: unknown, path: string): MessageRecord => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("Expected a plain message object.", path);
  }

  return input as MessageRecord;
};

const expectKeys = (record: MessageRecord, keys: readonly string[], path: string): void => {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) {
      invalid(`Unknown field "${key}".`, `${path}.${key}`);
    }
  }
};

const required = (record: MessageRecord, key: string, path: string): unknown => {
  if (!hasOwn(record, key)) {
    return invalid(`Missing required field "${key}".`, `${path}.${key}`);
  }

  return record[key];
};

const readString = (input: unknown, path: string, allowEmpty = false): string => {
  if (typeof input !== "string" || (!allowEmpty && input.length === 0)) {
    return invalid("Expected a non-empty string.", path);
  }

  return input;
};

const readStringField = (
  record: MessageRecord,
  key: string,
  path: string,
  allowEmpty = false,
): string => readString(required(record, key, path), `${path}.${key}`, allowEmpty);

const readNonNegativeInteger = (input: unknown, path: string): number => {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0) {
    return invalid("Expected a non-negative integer.", path);
  }

  return input;
};

const readNonNegativeIntegerField = (record: MessageRecord, key: string, path: string): number =>
  readNonNegativeInteger(required(record, key, path), `${path}.${key}`);

const readNonNegativeNumber = (input: unknown, path: string): number => {
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    return invalid("Expected a non-negative finite number.", path);
  }

  return input;
};

const readNonNegativeNumberField = (record: MessageRecord, key: string, path: string): number =>
  readNonNegativeNumber(required(record, key, path), `${path}.${key}`);

const readBooleanField = (record: MessageRecord, key: string, path: string): boolean => {
  const value = required(record, key, path);
  if (typeof value !== "boolean") {
    return invalid("Expected a boolean.", `${path}.${key}`);
  }

  return value;
};

const readArrayField = (record: MessageRecord, key: string, path: string): unknown[] => {
  const value = required(record, key, path);
  if (!Array.isArray(value)) {
    return invalid("Expected an array.", `${path}.${key}`);
  }

  return value;
};

const readProtocolVersion = (record: MessageRecord, path: string): typeof PROTOCOL_VERSION => {
  const value = required(record, "protocolVersion", path);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return invalid("Expected an integer protocol version.", `${path}.protocolVersion`);
  }

  if (value !== PROTOCOL_VERSION) {
    throw new ProtocolDecodeError(
      "PROTOCOL_MISMATCH",
      `Unsupported protocol version ${value}; expected ${PROTOCOL_VERSION}.`,
      `${path}.protocolVersion`,
    );
  }

  return PROTOCOL_VERSION;
};

const readRequestMeta = (record: MessageRecord, path: string): RequestMeta => ({
  protocolVersion: readProtocolVersion(record, path),
  workerGeneration: readNonNegativeIntegerField(record, "workerGeneration", path),
  requestId: readNonNegativeIntegerField(record, "requestId", path),
});

const readDocumentMeta = (record: MessageRecord, path: string): DocumentMeta => ({
  sessionId: readStringField(record, "sessionId", path),
  documentUri: readStringField(record, "documentUri", path),
});

const readVersionedDocumentMeta = (record: MessageRecord, path: string): VersionedDocumentMeta => ({
  ...readDocumentMeta(record, path),
  documentVersion: readNonNegativeIntegerField(record, "documentVersion", path),
});

const decodeTextPosition = (input: unknown, path: string): TextPosition => {
  const record = expectRecord(input, path);
  expectKeys(record, ["line", "character"], path);

  return {
    line: readNonNegativeIntegerField(record, "line", path),
    character: readNonNegativeIntegerField(record, "character", path),
  };
};

const decodeTextRange = (input: unknown, path: string): TextRange => {
  const record = expectRecord(input, path);
  expectKeys(record, ["start", "end"], path);

  return {
    start: decodeTextPosition(required(record, "start", path), `${path}.start`),
    end: decodeTextPosition(required(record, "end", path), `${path}.end`),
  };
};

const decodeTextChange = (input: unknown, path: string): TextChange => {
  const record = expectRecord(input, path);
  expectKeys(record, ["rangeOffset", "rangeLength", "text"], path);

  return {
    rangeOffset: readNonNegativeIntegerField(record, "rangeOffset", path),
    rangeLength: readNonNegativeIntegerField(record, "rangeLength", path),
    text: readStringField(record, "text", path, true),
  };
};

const decodeOpenDocument = (record: MessageRecord, path: string): OpenDocument => {
  expectKeys(
    record,
    [
      "type",
      "protocolVersion",
      "workerGeneration",
      "requestId",
      "sessionId",
      "documentUri",
      "documentVersion",
      "languageId",
      "text",
    ],
    path,
  );

  return {
    type: "OpenDocument",
    ...readRequestMeta(record, path),
    ...readVersionedDocumentMeta(record, path),
    languageId: readStringField(record, "languageId", path),
    text: readStringField(record, "text", path, true),
  };
};

const decodeApplyChanges = (record: MessageRecord, path: string): ApplyChanges => {
  expectKeys(
    record,
    [
      "type",
      "protocolVersion",
      "workerGeneration",
      "requestId",
      "sessionId",
      "documentUri",
      "baseVersion",
      "nextVersion",
      "changes",
    ],
    path,
  );

  return {
    type: "ApplyChanges",
    ...readRequestMeta(record, path),
    ...readDocumentMeta(record, path),
    baseVersion: readNonNegativeIntegerField(record, "baseVersion", path),
    nextVersion: readNonNegativeIntegerField(record, "nextVersion", path),
    changes: readArrayField(record, "changes", path).map((change, index) =>
      decodeTextChange(change, `${path}.changes[${index}]`),
    ),
  };
};

const decodeReplaceDocument = (record: MessageRecord, path: string): ReplaceDocument => {
  expectKeys(
    record,
    [
      "type",
      "protocolVersion",
      "workerGeneration",
      "requestId",
      "sessionId",
      "documentUri",
      "documentVersion",
      "text",
    ],
    path,
  );

  return {
    type: "ReplaceDocument",
    ...readRequestMeta(record, path),
    ...readVersionedDocumentMeta(record, path),
    text: readStringField(record, "text", path, true),
  };
};

const decodeCloseDocument = (record: MessageRecord, path: string): CloseDocument => {
  expectKeys(
    record,
    [
      "type",
      "protocolVersion",
      "workerGeneration",
      "requestId",
      "sessionId",
      "documentUri",
      "documentVersion",
    ],
    path,
  );

  return {
    type: "CloseDocument",
    ...readRequestMeta(record, path),
    ...readVersionedDocumentMeta(record, path),
  };
};

const decodeInspectDocument = (record: MessageRecord, path: string): InspectDocument => {
  expectKeys(
    record,
    [
      "type",
      "protocolVersion",
      "workerGeneration",
      "requestId",
      "sessionId",
      "documentUri",
      "documentVersion",
      "maxDepth",
      "maxNodes",
    ],
    path,
  );

  return {
    type: "InspectDocument",
    ...readRequestMeta(record, path),
    ...readVersionedDocumentMeta(record, path),
    maxDepth: readNonNegativeIntegerField(record, "maxDepth", path),
    maxNodes: readNonNegativeIntegerField(record, "maxNodes", path),
  };
};

const decodeWorkerReady = (record: MessageRecord, path: string): WorkerReady => {
  expectKeys(record, ["type", "protocolVersion", "workerGeneration"], path);

  return {
    type: "WorkerReady",
    protocolVersion: readProtocolVersion(record, path),
    workerGeneration: readNonNegativeIntegerField(record, "workerGeneration", path),
  };
};

const decodeParseResult = (record: MessageRecord, path: string): ParseResult => {
  expectKeys(
    record,
    [
      "type",
      "protocolVersion",
      "workerGeneration",
      "requestId",
      "sessionId",
      "documentUri",
      "documentVersion",
      "parseTimeMs",
      "hasErrors",
      "changedRanges",
    ],
    path,
  );

  return {
    type: "ParseResult",
    ...readRequestMeta(record, path),
    ...readVersionedDocumentMeta(record, path),
    parseTimeMs: readNonNegativeNumberField(record, "parseTimeMs", path),
    hasErrors: readBooleanField(record, "hasErrors", path),
    changedRanges: readArrayField(record, "changedRanges", path).map((range, index) =>
      decodeTextRange(range, `${path}.changedRanges[${index}]`),
    ),
  };
};

const readWorkerErrorCode = (input: unknown, path: string): WorkerErrorCode => {
  if (typeof input !== "string" || !WORKER_ERROR_CODES.includes(input as WorkerErrorCode)) {
    return invalid("Unknown Worker error code.", path);
  }

  return input as WorkerErrorCode;
};

const readOptionalStringField = (
  record: MessageRecord,
  key: string,
  path: string,
): string | undefined => {
  if (!hasOwn(record, key)) {
    return undefined;
  }

  return readString(record[key], `${path}.${key}`);
};

const readOptionalNonNegativeIntegerField = (
  record: MessageRecord,
  key: string,
  path: string,
): number | undefined => {
  if (!hasOwn(record, key)) {
    return undefined;
  }

  return readNonNegativeInteger(record[key], `${path}.${key}`);
};

const decodeWorkerError = (record: MessageRecord, path: string): WorkerError => {
  expectKeys(
    record,
    [
      "type",
      "protocolVersion",
      "workerGeneration",
      "requestId",
      "code",
      "message",
      "sessionId",
      "documentUri",
      "documentVersion",
    ],
    path,
  );

  const requestId = required(record, "requestId", path);
  if (requestId !== null && (typeof requestId !== "number" || !Number.isInteger(requestId))) {
    return invalid("Expected requestId to be a non-negative integer or null.", `${path}.requestId`);
  }
  if (typeof requestId === "number" && requestId < 0) {
    return invalid("Expected requestId to be a non-negative integer or null.", `${path}.requestId`);
  }

  const sessionId = readOptionalStringField(record, "sessionId", path);
  const documentUri = readOptionalStringField(record, "documentUri", path);
  const documentVersion = readOptionalNonNegativeIntegerField(record, "documentVersion", path);

  return {
    type: "WorkerError",
    protocolVersion: readProtocolVersion(record, path),
    workerGeneration: readNonNegativeIntegerField(record, "workerGeneration", path),
    requestId,
    code: readWorkerErrorCode(required(record, "code", path), `${path}.code`),
    message: readStringField(record, "message", path),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(documentUri === undefined ? {} : { documentUri }),
    ...(documentVersion === undefined ? {} : { documentVersion }),
  };
};

export function decodeWorkerMessage(input: unknown): ProtocolMessage {
  const record = expectRecord(input, "$message");
  const type = readStringField(record, "type", "$message");

  switch (type) {
    case "OpenDocument":
      return decodeOpenDocument(record, "$message");
    case "ApplyChanges":
      return decodeApplyChanges(record, "$message");
    case "ReplaceDocument":
      return decodeReplaceDocument(record, "$message");
    case "CloseDocument":
      return decodeCloseDocument(record, "$message");
    case "InspectDocument":
      return decodeInspectDocument(record, "$message");
    case "WorkerReady":
      return decodeWorkerReady(record, "$message");
    case "ParseResult":
      return decodeParseResult(record, "$message");
    case "WorkerError":
      return decodeWorkerError(record, "$message");
    default:
      return invalid(`Unknown message type "${type}".`, "$message.type");
  }
}

export const decodeProtocolMessage = decodeWorkerMessage;

export function isProtocolMessage(input: unknown): input is ProtocolMessage {
  try {
    decodeWorkerMessage(input);
    return true;
  } catch {
    return false;
  }
}

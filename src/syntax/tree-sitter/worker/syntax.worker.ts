import { sqlLanguageDefinition } from "../../../languages/sql/definition";
import type {
  GetHighlights,
  HighlightsResult,
  FoldingRangesResult,
  GetFoldingRanges,
  InspectDocument,
  InspectResult,
  ParseResult,
  SelectionRangesResult,
  GetSelectionRanges,
  WorkerRequest,
} from "../protocol";
import { DocumentManager, DocumentManagerError } from "./document-manager";
import { collectHighlightTokens } from "./highlight";
import { collectFoldingRanges } from "./folding";
import { AstInspector } from "./inspector";
import { WorkerRuntime } from "./runtime";
import { collectSelectionPaths } from "./selection";
import { installWorkerHost } from "./worker";

interface WorkerBootstrapMessage {
  type: "initialize";
  workerGeneration: number;
}

function isWorkerBootstrapMessage(input: unknown): input is WorkerBootstrapMessage {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    "type" in input &&
    input.type === "initialize" &&
    "workerGeneration" in input &&
    typeof input.workerGeneration === "number" &&
    Number.isInteger(input.workerGeneration) &&
    input.workerGeneration >= 0
  );
}

function fullTextRange(text: string): ParseResult["changedRanges"] {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      line += 1;
      lineStart = index + 1;
    }
  }

  return [
    {
      start: { line: 0, character: 0 },
      end: { line, character: text.length - lineStart },
    },
  ];
}

function parseResultForOpen(
  request: Extract<WorkerRequest, { type: "OpenDocument" }>,
  documentVersion: number,
  parseTimeMs: number,
  hasErrors: boolean,
): ParseResult {
  return {
    type: "ParseResult",
    protocolVersion: request.protocolVersion,
    workerGeneration: request.workerGeneration,
    requestId: request.requestId,
    sessionId: request.sessionId,
    documentUri: request.documentUri,
    documentVersion,
    parseTimeMs,
    hasErrors,
    changedRanges: fullTextRange(request.text),
  };
}

function startWorker(workerGeneration: number): void {
  const runtime = new WorkerRuntime();
  runtime.registerLanguage(sqlLanguageDefinition);
  const documents = new DocumentManager(runtime);
  const inspector = new AstInspector();

  installWorkerHost({
    workerGeneration,
    handleRequest: async (request) => {
      switch (request.type) {
        case "OpenDocument": {
          const startedAt = globalThis.performance.now();
          const session = await documents.openDocument(request);
          return parseResultForOpen(
            request,
            session.documentVersion,
            globalThis.performance.now() - startedAt,
            session.tree.rootNode.hasError,
          );
        }
        case "ApplyChanges":
          return documents.applyChanges(request);
        case "ReplaceDocument":
          return documents.replaceDocument(request);
        case "CloseDocument":
          documents.closeDocument(request.sessionId);
          return undefined;
        case "InspectDocument": {
          const session = documents.getSession(request.sessionId);
          if (session === undefined || session.documentUri !== request.documentUri) {
            throw new DocumentManagerError(
              "SESSION_NOT_FOUND",
              `Session "${request.sessionId}" does not own document "${request.documentUri}".`,
            );
          }

          const result = inspector.inspect(session, request);
          return inspectResultForRequest(request, session.documentVersion, result);
        }
        case "GetHighlights":
          return getHighlightsForRequest(request, documents, runtime);
        case "GetFoldingRanges":
          return getFoldingRangesForRequest(request, documents, runtime);
        case "GetSelectionRanges":
          return getSelectionRangesForRequest(request, documents);
      }
    },
  });
}

async function getHighlightsForRequest(
  request: GetHighlights,
  documents: DocumentManager,
  runtime: WorkerRuntime,
): Promise<HighlightsResult> {
  const session = documents.getSession(request.sessionId);
  if (session === undefined || session.documentUri !== request.documentUri) {
    throw new DocumentManagerError(
      "SESSION_NOT_FOUND",
      `Session "${request.sessionId}" does not own document "${request.documentUri}".`,
    );
  }
  if (session.state === "desynced") {
    throw new DocumentManagerError(
      "RESYNC_REQUIRED",
      `Session "${request.sessionId}" requires a full document resync.`,
    );
  }
  if (request.expectedVersion !== session.documentVersion) {
    throw new DocumentManagerError(
      "VERSION_MISMATCH",
      `Expected document version ${request.expectedVersion}, found ${session.documentVersion}.`,
    );
  }

  const languageRuntime = await runtime.loadLanguage(session.languageId);
  const query = await languageRuntime.getQuery("highlights");
  if (
    documents.getSession(request.sessionId) !== session ||
    request.expectedVersion !== session.documentVersion
  ) {
    throw new DocumentManagerError(
      "VERSION_MISMATCH",
      `Document "${request.documentUri}" changed before highlights completed.`,
    );
  }

  return {
    type: "HighlightsResult",
    protocolVersion: request.protocolVersion,
    workerGeneration: request.workerGeneration,
    requestId: request.requestId,
    sessionId: session.sessionId,
    documentUri: session.documentUri,
    documentVersion: session.documentVersion,
    tokens: collectHighlightTokens(session, query),
  };
}

async function getFoldingRangesForRequest(
  request: GetFoldingRanges,
  documents: DocumentManager,
  runtime: WorkerRuntime,
): Promise<FoldingRangesResult> {
  const session = documents.getSession(request.sessionId);
  if (session === undefined || session.documentUri !== request.documentUri) {
    throw new DocumentManagerError(
      "SESSION_NOT_FOUND",
      `Session "${request.sessionId}" does not own document "${request.documentUri}".`,
    );
  }
  if (session.state === "desynced") {
    throw new DocumentManagerError(
      "RESYNC_REQUIRED",
      `Session "${request.sessionId}" requires a full document resync.`,
    );
  }
  if (request.expectedVersion !== session.documentVersion) {
    throw new DocumentManagerError(
      "VERSION_MISMATCH",
      `Expected document version ${request.expectedVersion}, found ${session.documentVersion}.`,
    );
  }

  const languageRuntime = await runtime.loadLanguage(session.languageId);
  const query = await languageRuntime.getQuery("folds");
  if (
    documents.getSession(request.sessionId) !== session ||
    request.expectedVersion !== session.documentVersion
  ) {
    throw new DocumentManagerError(
      "VERSION_MISMATCH",
      `Document "${request.documentUri}" changed before folding ranges completed.`,
    );
  }

  return {
    type: "FoldingRangesResult",
    protocolVersion: request.protocolVersion,
    workerGeneration: request.workerGeneration,
    requestId: request.requestId,
    sessionId: session.sessionId,
    documentUri: session.documentUri,
    documentVersion: session.documentVersion,
    ranges: collectFoldingRanges(session, query),
  };
}

function getSelectionRangesForRequest(
  request: GetSelectionRanges,
  documents: DocumentManager,
): SelectionRangesResult {
  const session = documents.getSession(request.sessionId);
  if (session === undefined || session.documentUri !== request.documentUri) {
    throw new DocumentManagerError(
      "SESSION_NOT_FOUND",
      `Session "${request.sessionId}" does not own document "${request.documentUri}".`,
    );
  }
  if (session.state === "desynced") {
    throw new DocumentManagerError(
      "RESYNC_REQUIRED",
      `Session "${request.sessionId}" requires a full document resync.`,
    );
  }
  if (request.expectedVersion !== session.documentVersion) {
    throw new DocumentManagerError(
      "VERSION_MISMATCH",
      `Expected document version ${request.expectedVersion}, found ${session.documentVersion}.`,
    );
  }

  return {
    type: "SelectionRangesResult",
    protocolVersion: request.protocolVersion,
    workerGeneration: request.workerGeneration,
    requestId: request.requestId,
    sessionId: session.sessionId,
    documentUri: session.documentUri,
    documentVersion: session.documentVersion,
    selections: collectSelectionPaths(session, request.positions),
  };
}

function inspectResultForRequest(
  request: InspectDocument,
  documentVersion: number,
  result: ReturnType<AstInspector["inspect"]>,
): InspectResult {
  return {
    type: "InspectResult",
    protocolVersion: request.protocolVersion,
    workerGeneration: request.workerGeneration,
    requestId: request.requestId,
    sessionId: request.sessionId,
    documentUri: request.documentUri,
    documentVersion,
    root: result.root,
    nodeCount: result.nodeCount,
    truncated: result.truncated,
  };
}

const bootstrapListener = (event: MessageEvent<unknown>): void => {
  if (!isWorkerBootstrapMessage(event.data)) {
    return;
  }

  globalThis.removeEventListener("message", bootstrapListener);
  startWorker(event.data.workerGeneration);
};

globalThis.addEventListener("message", bootstrapListener);

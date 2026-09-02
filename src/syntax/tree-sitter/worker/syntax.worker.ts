import { sqlLanguageDefinition } from "../../../languages/sql/definition";
import type { ParseResult, WorkerRequest } from "../protocol";
import { DocumentManager } from "./document-manager";
import { WorkerRuntime } from "./runtime";
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
        case "InspectDocument":
          throw new Error("InspectDocument is not available in M1-11.");
      }
    },
  });
}

const bootstrapListener = (event: MessageEvent<unknown>): void => {
  if (!isWorkerBootstrapMessage(event.data)) {
    return;
  }

  globalThis.removeEventListener("message", bootstrapListener);
  startWorker(event.data.workerGeneration);
};

globalThis.addEventListener("message", bootstrapListener);

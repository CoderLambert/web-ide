import {
  decodeWorkerMessage,
  PROTOCOL_VERSION,
  ProtocolDecodeError,
  type ApplyChanges,
  type CloseDocument,
  type FoldingRangesResult,
  type GetFoldingRanges,
  type GetHighlights,
  type GetSelectionRanges,
  type HighlightsResult,
  type InspectDocument,
  type InspectResult,
  type OpenDocument,
  type ParseResult,
  type ReplaceDocument,
  type SelectionRangesResult,
  type WorkerError,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";

type OwnedRequestFields = "protocolVersion" | "workerGeneration" | "requestId";

export type TreeSitterClientRequest =
  | Omit<OpenDocument, OwnedRequestFields>
  | Omit<ApplyChanges, OwnedRequestFields>
  | Omit<ReplaceDocument, OwnedRequestFields>
  | Omit<CloseDocument, OwnedRequestFields>
  | Omit<InspectDocument, OwnedRequestFields>
  | Omit<GetHighlights, OwnedRequestFields>
  | Omit<GetFoldingRanges, OwnedRequestFields>
  | Omit<GetSelectionRanges, OwnedRequestFields>;

export interface TreeSitterClientWorker {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
}

export type TreeSitterClientErrorCode =
  | "WORKER_RESTARTED"
  | "WORKER_FAILED"
  | "CLIENT_DISPOSED"
  | "POST_MESSAGE_FAILED";

export class TreeSitterClientError extends Error {
  readonly code: TreeSitterClientErrorCode | WorkerError["code"];

  constructor(
    code: TreeSitterClientErrorCode | WorkerError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TreeSitterClientError";
    this.code = code;
  }
}

interface PendingRequest {
  requestId: number;
  workerGeneration: number;
  sessionId: string;
  documentUri: string;
  documentVersion: number | undefined;
  resolve: (response: WorkerResponse) => void;
  reject: (error: unknown) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isWorkerRequest(message: WorkerRequest | WorkerResponse): message is WorkerRequest {
  switch (message.type) {
    case "OpenDocument":
    case "ApplyChanges":
    case "ReplaceDocument":
    case "CloseDocument":
    case "InspectDocument":
    case "GetHighlights":
    case "GetFoldingRanges":
    case "GetSelectionRanges":
      return true;
    default:
      return false;
  }
}

function documentVersionForRequest(request: TreeSitterClientRequest): number | undefined {
  if ("documentVersion" in request) {
    return request.documentVersion;
  }
  if ("expectedVersion" in request) {
    return request.expectedVersion;
  }
  return request.type === "ApplyChanges" ? request.nextVersion : undefined;
}

export class TreeSitterClient {
  private worker: TreeSitterClientWorker;
  private generationValue: number;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    this.handleMessage(event.data);
  };
  private readonly onError = (event: ErrorEvent): void => {
    this.rejectAll(
      new TreeSitterClientError(
        "WORKER_FAILED",
        `Worker failed: ${event.message || "unknown error"}.`,
      ),
    );
  };
  private disposed = false;

  constructor(worker: TreeSitterClientWorker, workerGeneration: number) {
    if (!Number.isInteger(workerGeneration) || workerGeneration < 0) {
      throw new Error("workerGeneration must be a non-negative integer.");
    }

    this.worker = worker;
    this.generationValue = workerGeneration;
    this.attachWorker();
  }

  get workerGeneration(): number {
    return this.generationValue;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  request(request: TreeSitterClientRequest): Promise<WorkerResponse> {
    this.assertUsable();

    let decodedRequest: WorkerRequest;
    try {
      decodedRequest = this.prepareRequest(request);
    } catch (error: unknown) {
      return Promise.reject(error);
    }

    const requestId = decodedRequest.requestId;
    const promise = new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, {
        requestId,
        workerGeneration: this.generationValue,
        sessionId: decodedRequest.sessionId,
        documentUri: decodedRequest.documentUri,
        documentVersion: documentVersionForRequest(request),
        resolve,
        reject,
      });
    });

    try {
      this.postRequest(decodedRequest);
    } catch (error: unknown) {
      this.pending.delete(requestId);
      return Promise.reject(error);
    }

    return promise;
  }

  /** Send a request that intentionally has no response, such as CloseDocument. */
  send(request: TreeSitterClientRequest): void {
    this.assertUsable();
    this.postRequest(this.prepareRequest(request));
  }

  replaceWorker(worker: TreeSitterClientWorker, workerGeneration: number): void {
    this.assertUsable();
    if (!Number.isInteger(workerGeneration) || workerGeneration < 0) {
      throw new Error("workerGeneration must be a non-negative integer.");
    }

    this.rejectAll(
      new TreeSitterClientError(
        "WORKER_RESTARTED",
        `Worker generation changed from ${this.generationValue} to ${workerGeneration}.`,
      ),
    );
    this.detachWorker();
    this.worker = worker;
    this.generationValue = workerGeneration;
    this.attachWorker();
  }

  setWorkerGeneration(workerGeneration: number): void {
    this.assertUsable();
    if (!Number.isInteger(workerGeneration) || workerGeneration < 0) {
      throw new Error("workerGeneration must be a non-negative integer.");
    }
    if (workerGeneration === this.generationValue) {
      return;
    }

    this.rejectAll(
      new TreeSitterClientError(
        "WORKER_RESTARTED",
        `Worker generation changed from ${this.generationValue} to ${workerGeneration}.`,
      ),
    );
    this.generationValue = workerGeneration;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.detachWorker();
    this.rejectAll(
      new TreeSitterClientError("CLIENT_DISPOSED", "Tree-sitter client was disposed."),
    );
  }

  private handleMessage(input: unknown): void {
    let response: WorkerResponse;
    try {
      const decoded = decodeWorkerMessage(input);
      if (decoded.type === "WorkerReady") {
        return;
      }
      if (
        decoded.type !== "ParseResult" &&
        decoded.type !== "InspectResult" &&
        decoded.type !== "HighlightsResult" &&
        decoded.type !== "FoldingRangesResult" &&
        decoded.type !== "SelectionRangesResult" &&
        decoded.type !== "WorkerError"
      ) {
        return;
      }
      response = decoded;
    } catch {
      return;
    }

    const requestId = response.requestId;
    if (requestId === null) {
      return;
    }
    const pending = this.pending.get(requestId);
    if (pending === undefined || !this.matchesPending(response, pending)) {
      return;
    }

    this.pending.delete(requestId);
    if (response.type === "WorkerError") {
      pending.reject(
        new TreeSitterClientError(response.code, response.message, { cause: response }),
      );
      return;
    }

    pending.resolve(response);
  }

  private matchesPending(
    response:
      | ParseResult
      | InspectResult
      | HighlightsResult
      | FoldingRangesResult
      | SelectionRangesResult
      | WorkerError,
    pending: PendingRequest,
  ): boolean {
    if (
      response.workerGeneration !== pending.workerGeneration ||
      response.requestId !== pending.requestId
    ) {
      return false;
    }

    if (
      response.type === "ParseResult" ||
      response.type === "InspectResult" ||
      response.type === "HighlightsResult" ||
      response.type === "FoldingRangesResult" ||
      response.type === "SelectionRangesResult"
    ) {
      return (
        response.sessionId === pending.sessionId &&
        response.documentUri === pending.documentUri &&
        (pending.documentVersion === undefined ||
          response.documentVersion === pending.documentVersion)
      );
    }

    return (
      (response.sessionId === undefined || response.sessionId === pending.sessionId) &&
      (response.documentUri === undefined || response.documentUri === pending.documentUri) &&
      (pending.documentVersion === undefined ||
        response.documentVersion === undefined ||
        response.documentVersion === pending.documentVersion)
    );
  }

  private rejectAll(error: unknown): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) {
      request.reject(error);
    }
  }

  private attachWorker(): void {
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onError);
  }

  private detachWorker(): void {
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onError);
  }

  private prepareRequest(request: TreeSitterClientRequest): WorkerRequest {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const message = {
      ...request,
      protocolVersion: PROTOCOL_VERSION,
      workerGeneration: this.generationValue,
      requestId,
    } as WorkerRequest;
    const decoded = decodeWorkerMessage(message);
    if (!isWorkerRequest(decoded)) {
      throw new ProtocolDecodeError(
        "INVALID_MESSAGE",
        `Message type "${decoded.type}" is not a Worker request.`,
      );
    }
    return decoded;
  }

  private postRequest(request: WorkerRequest): void {
    try {
      this.worker.postMessage(request);
    } catch (error: unknown) {
      throw new TreeSitterClientError(
        "POST_MESSAGE_FAILED",
        `Failed to post request ${request.requestId}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new TreeSitterClientError("CLIENT_DISPOSED", "Tree-sitter client was disposed.");
    }
  }
}

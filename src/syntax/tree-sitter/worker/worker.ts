import {
  decodeWorkerMessage,
  PROTOCOL_VERSION,
  ProtocolDecodeError,
  WORKER_ERROR_CODES,
  type ProtocolMessage,
  type WorkerErrorCode,
  type WorkerError,
  type WorkerRequest,
  type WorkerResponse,
} from "../protocol";

export type WorkerRequestHandler = (
  request: WorkerRequest,
) => WorkerResponse | void | Promise<WorkerResponse | void>;

export interface WorkerHostOptions {
  workerGeneration: number;
  handleRequest: WorkerRequestHandler;
  postMessage?: (message: WorkerResponse) => void;
}

export interface WorkerHostPort {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: WorkerResponse): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isWorkerRequest(message: ProtocolMessage): message is WorkerRequest {
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

function readErrorCode(error: unknown): WorkerErrorCode {
  if (error instanceof ProtocolDecodeError) {
    return error.code;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const code = error.code;
    if (WORKER_ERROR_CODES.includes(code as WorkerErrorCode)) {
      return code as WorkerErrorCode;
    }
  }

  return "INTERNAL_ERROR";
}

function isWorkerResponse(message: ProtocolMessage): message is WorkerResponse {
  switch (message.type) {
    case "WorkerReady":
    case "ParseResult":
    case "InspectResult":
    case "HighlightsResult":
    case "FoldingRangesResult":
    case "SelectionRangesResult":
    case "WorkerError":
      return true;
    default:
      return false;
  }
}

export class WorkerHost {
  private readonly workerGeneration: number;
  private readonly handleRequest: WorkerRequestHandler;
  private readonly postMessage: (message: WorkerResponse) => void;
  private queue: Promise<void> = Promise.resolve();
  private started = false;

  constructor(options: WorkerHostOptions) {
    if (!Number.isInteger(options.workerGeneration) || options.workerGeneration < 0) {
      throw new Error("workerGeneration must be a non-negative integer.");
    }

    this.workerGeneration = options.workerGeneration;
    this.handleRequest = options.handleRequest;
    this.postMessage = options.postMessage ?? ((message) => globalThis.postMessage(message));
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.postMessage({
      type: "WorkerReady",
      protocolVersion: PROTOCOL_VERSION,
      workerGeneration: this.workerGeneration,
    });
  }

  receive(input: unknown): void {
    this.start();
    this.queue = this.queue.then(() => this.process(input));
  }

  whenIdle(): Promise<void> {
    return this.queue;
  }

  private async process(input: unknown): Promise<void> {
    let request: WorkerRequest | undefined;
    try {
      const message = decodeWorkerMessage(input);
      if (!isWorkerRequest(message)) {
        throw new ProtocolDecodeError(
          "INVALID_MESSAGE",
          `Message type "${message.type}" is not a Worker request.`,
        );
      }
      request = message;

      const response = await this.handleRequest(request);
      if (response === undefined) {
        return;
      }

      const decodedResponse = decodeWorkerMessage(response);
      if (!isWorkerResponse(decodedResponse)) {
        throw new ProtocolDecodeError(
          "INVALID_MESSAGE",
          `Message type "${decodedResponse.type}" is not a Worker response.`,
        );
      }
      this.postMessage(decodedResponse);
    } catch (error: unknown) {
      this.postMessage(this.createError(error, request));
    }
  }

  private createError(error: unknown, request: WorkerRequest | undefined): WorkerError {
    return {
      type: "WorkerError",
      protocolVersion: PROTOCOL_VERSION,
      workerGeneration: this.workerGeneration,
      requestId: request?.requestId ?? null,
      code: readErrorCode(error),
      message: errorMessage(error),
      ...(request === undefined ? {} : { sessionId: request.sessionId }),
      ...(request === undefined ? {} : { documentUri: request.documentUri }),
      ...(request !== undefined && "documentVersion" in request
        ? { documentVersion: request.documentVersion }
        : request !== undefined && "expectedVersion" in request
          ? { documentVersion: request.expectedVersion }
          : {}),
    };
  }
}

function globalWorkerPort(): WorkerHostPort {
  return {
    addEventListener: (type, listener) => {
      globalThis.addEventListener(type, listener as EventListener);
    },
    postMessage: (message) => {
      globalThis.postMessage(message);
    },
  };
}

export function installWorkerHost(
  options: Omit<WorkerHostOptions, "postMessage">,
  port: WorkerHostPort = globalWorkerPort(),
): WorkerHost {
  const host = new WorkerHost({ ...options, postMessage: (message) => port.postMessage(message) });
  port.addEventListener("message", (event) => host.receive(event.data));
  host.start();
  return host;
}

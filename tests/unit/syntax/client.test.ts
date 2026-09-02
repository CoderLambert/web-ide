import { describe, expect, it, vi } from "vite-plus/test";

import {
  PROTOCOL_VERSION,
  type InspectResult,
  type ParseResult,
  type WorkerError,
} from "../../../src/syntax/tree-sitter/protocol";
import {
  TreeSitterClient,
  type TreeSitterClientRequest,
  type TreeSitterClientWorker,
} from "../../../src/syntax/tree-sitter/client";

type MessageListener = (event: MessageEvent<unknown>) => void;
type ErrorListener = (event: ErrorEvent) => void;

class FakeWorker implements TreeSitterClientWorker {
  private readonly messageListeners = new Set<MessageListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  readonly posted: unknown[] = [];
  readonly postMessageSpy = vi.fn((message: unknown) => this.posted.push(message));

  addEventListener(type: "message" | "error", listener: MessageListener | ErrorListener): void {
    if (type === "message") {
      this.messageListeners.add(listener as MessageListener);
    } else {
      this.errorListeners.add(listener as ErrorListener);
    }
  }

  removeEventListener(type: "message" | "error", listener: MessageListener | ErrorListener): void {
    if (type === "message") {
      this.messageListeners.delete(listener as MessageListener);
    } else {
      this.errorListeners.delete(listener as ErrorListener);
    }
  }

  postMessage(message: unknown): void {
    this.postMessageSpy(message);
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) {
      listener({ data } as MessageEvent<unknown>);
    }
  }

  emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener({ message } as ErrorEvent);
    }
  }
}

const request = (documentVersion = 1): TreeSitterClientRequest => ({
  type: "OpenDocument",
  sessionId: "session-1",
  documentUri: "opaque-document-id",
  documentVersion,
  languageId: "sql",
  text: "SELECT 1;",
});

const result = (
  workerGeneration: number,
  documentVersion: number,
  sessionId = "session-1",
  documentUri = "opaque-document-id",
): ParseResult => ({
  type: "ParseResult",
  protocolVersion: PROTOCOL_VERSION,
  workerGeneration,
  requestId: 1,
  sessionId,
  documentUri,
  documentVersion,
  parseTimeMs: 0,
  hasErrors: false,
  changedRanges: [],
});

const inspection = (workerGeneration: number, documentVersion: number): InspectResult => ({
  type: "InspectResult",
  protocolVersion: PROTOCOL_VERSION,
  workerGeneration,
  requestId: 1,
  sessionId: "session-1",
  documentUri: "opaque-document-id",
  documentVersion,
  root: null,
  nodeCount: 0,
  truncated: true,
});

describe("TreeSitterClient", () => {
  it("allocates request ids and sends the current worker generation", async () => {
    const worker = new FakeWorker();
    const client = new TreeSitterClient(worker, 4);
    const pending = client.request(request());

    expect(worker.posted).toEqual([
      {
        type: "OpenDocument",
        protocolVersion: PROTOCOL_VERSION,
        workerGeneration: 4,
        requestId: 1,
        sessionId: "session-1",
        documentUri: "opaque-document-id",
        documentVersion: 1,
        languageId: "sql",
        text: "SELECT 1;",
      },
    ]);

    worker.emitMessage(result(4, 1));
    await expect(pending).resolves.toMatchObject({ type: "ParseResult", requestId: 1 });
    expect(client.pendingCount).toBe(0);
  });

  it("sends no-response document closes without creating a pending request", () => {
    const worker = new FakeWorker();
    const client = new TreeSitterClient(worker, 4);

    client.send({
      type: "CloseDocument",
      sessionId: "session-1",
      documentUri: "opaque-document-id",
      documentVersion: 1,
    });

    expect(worker.posted).toEqual([
      {
        type: "CloseDocument",
        protocolVersion: PROTOCOL_VERSION,
        workerGeneration: 4,
        requestId: 1,
        sessionId: "session-1",
        documentUri: "opaque-document-id",
        documentVersion: 1,
      },
    ]);
    expect(client.pendingCount).toBe(0);
  });

  it("resolves InspectDocument with the matching expected version", async () => {
    const worker = new FakeWorker();
    const client = new TreeSitterClient(worker, 4);
    const pending = client.request({
      type: "InspectDocument",
      sessionId: "session-1",
      documentUri: "opaque-document-id",
      expectedVersion: 8,
      maxDepth: 4,
      maxNodes: 25,
    });

    worker.emitMessage({ ...inspection(4, 7), requestId: 1 });
    expect(client.pendingCount).toBe(1);
    worker.emitMessage({ ...inspection(4, 8), requestId: 1 });

    await expect(pending).resolves.toMatchObject({
      type: "InspectResult",
      documentVersion: 8,
    });
    expect(client.pendingCount).toBe(0);
  });

  it("replaces its Worker and rejects requests from the previous generation", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const client = new TreeSitterClient(firstWorker, 4);
    const pending = client.request(request());

    client.replaceWorker(secondWorker, 5);

    await expect(pending).rejects.toMatchObject({ code: "WORKER_RESTARTED" });
    expect(client.pendingCount).toBe(0);
    const next = client.request(request(2));
    expect(secondWorker.posted.at(-1)).toMatchObject({ workerGeneration: 5, requestId: 2 });
    secondWorker.emitMessage({ ...result(5, 2), requestId: 2 });
    await expect(next).resolves.toMatchObject({ documentVersion: 2 });
  });

  it("drops stale generation, session, URI, and version results", async () => {
    const worker = new FakeWorker();
    const client = new TreeSitterClient(worker, 4);
    const pending = client.request(request(2));

    worker.emitMessage(result(3, 2));
    worker.emitMessage(result(4, 2, "old-session"));
    worker.emitMessage(result(4, 2, "session-1", "old-uri"));
    worker.emitMessage(result(4, 1));
    expect(client.pendingCount).toBe(1);

    worker.emitMessage(result(4, 2));
    await expect(pending).resolves.toMatchObject({ documentVersion: 2 });
  });

  it("rejects a matching WorkerError and drops stale errors", async () => {
    const worker = new FakeWorker();
    const client = new TreeSitterClient(worker, 4);
    const pending = client.request(request(2));
    const error: WorkerError = {
      type: "WorkerError",
      protocolVersion: PROTOCOL_VERSION,
      workerGeneration: 4,
      requestId: 1,
      code: "VERSION_MISMATCH",
      message: "version mismatch",
      sessionId: "session-1",
      documentUri: "opaque-document-id",
      documentVersion: 1,
    };

    worker.emitMessage({ ...error, documentVersion: 1 });
    expect(client.pendingCount).toBe(1);
    worker.emitMessage({ ...error, documentVersion: 2 });

    await expect(pending).rejects.toMatchObject({ code: "VERSION_MISMATCH" });
    expect(client.pendingCount).toBe(0);
  });

  it("rejects old-generation pending requests immediately on restart", async () => {
    const worker = new FakeWorker();
    const client = new TreeSitterClient(worker, 4);
    const pending = client.request(request());

    client.setWorkerGeneration(5);

    await expect(pending).rejects.toMatchObject({ code: "WORKER_RESTARTED" });
    expect(client.pendingCount).toBe(0);
    const next = client.request(request(2));
    expect(worker.posted.at(-1)).toMatchObject({ workerGeneration: 5, requestId: 2 });
    worker.emitMessage({ ...result(5, 2), requestId: 2 });
    await expect(next).resolves.toMatchObject({ documentVersion: 2 });
  });

  it("cleans pending requests when the Worker fails or the client is disposed", async () => {
    const worker = new FakeWorker();
    const client = new TreeSitterClient(worker, 4);
    const failed = client.request(request());
    worker.emitError("crashed");
    await expect(failed).rejects.toMatchObject({ code: "WORKER_FAILED" });
    expect(client.pendingCount).toBe(0);

    const disposed = client.request(request(2));
    client.dispose();
    client.dispose();
    await expect(disposed).rejects.toMatchObject({ code: "CLIENT_DISPOSED" });
    expect(client.pendingCount).toBe(0);
  });
});

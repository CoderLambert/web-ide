import { describe, expect, it, vi } from "vite-plus/test";

import {
  PROTOCOL_VERSION,
  type OpenDocument,
  type WorkerRequest,
  type WorkerResponse,
} from "../../../src/syntax/tree-sitter/protocol";
import {
  WorkerHost,
  type WorkerRequestHandler,
} from "../../../src/syntax/tree-sitter/worker/worker";

const request = (requestId: number): OpenDocument => ({
  type: "OpenDocument",
  protocolVersion: PROTOCOL_VERSION,
  workerGeneration: 4,
  requestId,
  sessionId: `session-${requestId}`,
  documentUri: `opaque-${requestId}`,
  documentVersion: 1,
  languageId: "sql",
  text: "SELECT 1;",
});

function createHost(handleRequest: WorkerRequestHandler = () => undefined) {
  const messages: WorkerResponse[] = [];
  const host = new WorkerHost({
    workerGeneration: 4,
    handleRequest,
    postMessage: (message) => messages.push(message),
  });

  return { host, messages };
}

describe("WorkerHost", () => {
  it("posts a protocol-correct WorkerReady once", () => {
    const { host, messages } = createHost();

    host.start();
    host.start();

    expect(messages).toEqual([
      {
        type: "WorkerReady",
        protocolVersion: PROTOCOL_VERSION,
        workerGeneration: 4,
      },
    ]);
  });

  it("processes requests in global FIFO order", async () => {
    const order: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const handleRequest = vi.fn(async (input: WorkerRequest) => {
      order.push(input.requestId);
      if (input.requestId === 1) {
        await firstFinished;
      }
    });
    const { host } = createHost(handleRequest);

    host.receive(request(1));
    host.receive(request(2));
    await Promise.resolve();
    expect(order).toEqual([1]);

    releaseFirst?.();
    await host.whenIdle();

    expect(order).toEqual([1, 2]);
  });

  it("turns invalid input into a structured error and continues with the next request", async () => {
    const handleRequest = vi.fn();
    const { host, messages } = createHost(handleRequest);

    host.receive({ type: "OpenDocument" });
    host.receive(request(1));
    await host.whenIdle();

    expect(messages).toEqual([
      {
        type: "WorkerReady",
        protocolVersion: PROTOCOL_VERSION,
        workerGeneration: 4,
      },
      expect.objectContaining({
        type: "WorkerError",
        code: "INVALID_MESSAGE",
        requestId: null,
      }),
    ]);
    expect(handleRequest).toHaveBeenCalledTimes(1);
  });

  it("does not poison the FIFO after a handler failure", async () => {
    const order: number[] = [];
    const handleRequest = vi.fn(async (input: WorkerRequest) => {
      order.push(input.requestId);
      if (input.requestId === 1) {
        throw new Error("request failed");
      }
    });
    const { host, messages } = createHost(handleRequest);

    host.receive(request(1));
    host.receive(request(2));
    await host.whenIdle();

    expect(order).toEqual([1, 2]);
    expect(messages).toEqual([
      {
        type: "WorkerReady",
        protocolVersion: PROTOCOL_VERSION,
        workerGeneration: 4,
      },
      expect.objectContaining({
        type: "WorkerError",
        code: "INTERNAL_ERROR",
        requestId: 1,
        message: "request failed",
      }),
    ]);
  });

  it("returns protocol mismatches as structured errors", async () => {
    const { host, messages } = createHost();

    host.receive({ ...request(1), protocolVersion: PROTOCOL_VERSION + 1 });
    await host.whenIdle();

    expect(messages[1]).toEqual(
      expect.objectContaining({
        type: "WorkerError",
        code: "PROTOCOL_MISMATCH",
        requestId: null,
      }),
    );
  });
});

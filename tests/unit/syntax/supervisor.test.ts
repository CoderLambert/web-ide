import { describe, expect, it, vi } from "vite-plus/test";

import { PROTOCOL_VERSION, type WorkerReady } from "../../../src/syntax/tree-sitter/protocol";
import {
  WorkerSupervisor,
  type WorkerLike,
  type OpenDocumentSnapshot,
} from "../../../src/syntax/tree-sitter/worker-supervisor";

type MessageListener = (event: MessageEvent<unknown>) => void;
type ErrorListener = (event: ErrorEvent) => void;

class FakeWorker implements WorkerLike {
  private messageListeners = new Set<MessageListener>();
  private errorListeners = new Set<ErrorListener>();
  readonly terminateSpy = vi.fn();

  postMessage(): void {
    // Supervisor tests only exercise lifecycle messages from the Worker.
  }

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

  terminate(): void {
    this.terminateSpy();
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

const ready = (workerGeneration: number): WorkerReady => ({
  type: "WorkerReady",
  protocolVersion: PROTOCOL_VERSION,
  workerGeneration,
});

describe("WorkerSupervisor", () => {
  it("waits for WorkerReady before entering ready", async () => {
    const worker = new FakeWorker();
    const createWorker = vi.fn(() => worker);
    const supervisor = new WorkerSupervisor({ createWorker });

    const startPromise = supervisor.start();

    expect(supervisor.state).toBe("starting");
    expect(supervisor.workerGeneration).toBe(1);
    expect(createWorker).toHaveBeenCalledWith(1);

    worker.emitMessage(ready(1));
    await startPromise;

    expect(supervisor.state).toBe("ready");
  });

  it("shares an in-flight start promise and increments generation per Worker", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const createWorker = vi.fn<(workerGeneration: number) => FakeWorker>(
      () => workers.shift() as FakeWorker,
    );
    const supervisor = new WorkerSupervisor({ createWorker });

    const firstStart = supervisor.start();
    expect(supervisor.start()).toBe(firstStart);
    firstWorker.emitMessage(ready(1));
    await firstStart;

    supervisor.terminate();
    const secondStart = supervisor.start();
    expect(supervisor.state).toBe("starting");
    expect(supervisor.workerGeneration).toBe(2);
    firstWorker.emitMessage(ready(1));
    expect(supervisor.state).toBe("starting");

    secondWorker.emitMessage(ready(2));
    await secondStart;

    expect(supervisor.state).toBe("ready");
    expect(createWorker.mock.calls.map(([generation]) => generation)).toEqual([1, 2]);
    expect(firstWorker.terminateSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched WorkerReady and does not enter ready", async () => {
    const worker = new FakeWorker();
    const supervisor = new WorkerSupervisor({ createWorker: () => worker });

    const startPromise = supervisor.start();
    worker.emitMessage({ ...ready(1), protocolVersion: PROTOCOL_VERSION + 1 });

    await expect(startPromise).rejects.toMatchObject({ code: "PROTOCOL_MISMATCH" });
    expect(supervisor.state).toBe("failed");
    expect(worker.terminateSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a generation mismatch and ignores non-ready messages while starting", async () => {
    const worker = new FakeWorker();
    const supervisor = new WorkerSupervisor({ createWorker: () => worker });

    const startPromise = supervisor.start();
    worker.emitMessage({
      type: "ParseResult",
      protocolVersion: PROTOCOL_VERSION,
      workerGeneration: 1,
      requestId: 1,
      sessionId: "session-1",
      documentUri: "opaque-1",
      documentVersion: 1,
      parseTimeMs: 0,
      hasErrors: false,
      changedRanges: [],
    });

    await expect(startPromise).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
    expect(supervisor.state).toBe("failed");
  });

  it("moves a ready Worker to failed on its error event when recovery is disabled", async () => {
    const worker = new FakeWorker();
    const supervisor = new WorkerSupervisor({
      createWorker: () => worker,
      maxAutoRecoveries: 0,
    });
    const startPromise = supervisor.start();
    worker.emitMessage(ready(1));
    await startPromise;

    worker.emitError("crashed");

    expect(supervisor.state).toBe("failed");
    expect(worker.terminateSpy).toHaveBeenCalledTimes(1);
  });

  it("restarts once and restores the latest open document snapshots", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    let latestSnapshot: OpenDocumentSnapshot = {
      documentUri: "opaque-document-id",
      sessionId: "session-1",
      languageId: "sql",
      documentVersion: 10,
      text: "SELECT 1;",
    };
    const onWorkerReady = vi.fn();
    const getOpenDocumentSnapshots = vi.fn(() => [latestSnapshot]);
    const restoreOpenDocuments = vi.fn(async () => undefined);
    const supervisor = new WorkerSupervisor({
      createWorker: vi.fn(() => workers.shift() as FakeWorker),
      getOpenDocumentSnapshots,
      onWorkerReady,
      restoreOpenDocuments,
    });

    const startPromise = supervisor.start();
    firstWorker.emitMessage(ready(1));
    await startPromise;
    firstWorker.emitError("crashed");
    latestSnapshot = { ...latestSnapshot, documentVersion: 12, text: "SELECT 2;" };

    expect(supervisor.state).toBe("starting");
    expect(supervisor.workerGeneration).toBe(2);
    const recoveryPromise = supervisor.start();
    secondWorker.emitMessage(ready(2));
    await recoveryPromise;

    expect(supervisor.state).toBe("ready");
    expect(onWorkerReady).toHaveBeenCalledTimes(2);
    expect(getOpenDocumentSnapshots).toHaveBeenCalledTimes(2);
    expect(restoreOpenDocuments).toHaveBeenCalledWith([latestSnapshot], 2);
  });

  it("does not restore a document closed during recovery", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const snapshots: OpenDocumentSnapshot[] = [
      {
        documentUri: "opaque-document-id",
        sessionId: "session-1",
        languageId: "sql",
        documentVersion: 10,
        text: "SELECT 1;",
      },
    ];
    const restoreOpenDocuments = vi.fn(async () => undefined);
    const supervisor = new WorkerSupervisor({
      createWorker: (generation) => (generation === 1 ? firstWorker : secondWorker),
      getOpenDocumentSnapshots: () => snapshots,
      restoreOpenDocuments,
    });

    const firstStart = supervisor.start();
    firstWorker.emitMessage(ready(1));
    await firstStart;
    firstWorker.emitError("crashed");
    snapshots.length = 0;
    const recovery = supervisor.start();
    secondWorker.emitMessage(ready(2));
    await recovery;

    expect(supervisor.state).toBe("ready");
    expect(restoreOpenDocuments).toHaveBeenCalledWith([], 2);
  });

  it("stops after the bounded auto-recovery attempt", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const supervisor = new WorkerSupervisor({
      createWorker: (generation) => (generation === 1 ? firstWorker : secondWorker),
    });

    const startPromise = supervisor.start();
    firstWorker.emitMessage(ready(1));
    await startPromise;
    firstWorker.emitError("first crash");
    secondWorker.emitError("second crash");

    expect(supervisor.state).toBe("failed");
    expect(secondWorker.terminateSpy).toHaveBeenCalledTimes(1);
  });
});

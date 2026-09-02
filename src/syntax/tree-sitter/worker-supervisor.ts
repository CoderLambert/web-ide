import { decodeWorkerMessage, ProtocolDecodeError } from "./protocol";

export type WorkerSupervisorState = "stopped" | "starting" | "ready" | "failed";

export interface WorkerLike {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface WorkerSupervisorOptions {
  createWorker: (workerGeneration: number) => WorkerLike;
}

export class WorkerSupervisorError extends Error {
  readonly code: "WORKER_START_FAILED" | "WORKER_FAILED" | "TERMINATED";

  constructor(
    code: "WORKER_START_FAILED" | "WORKER_FAILED" | "TERMINATED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkerSupervisorError";
    this.code = code;
  }
}

interface ActiveWorker {
  generation: number;
  worker: WorkerLike;
  onMessage: (event: MessageEvent<unknown>) => void;
  onError: (event: ErrorEvent) => void;
}

interface ReadyWaiter {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WorkerSupervisor {
  private readonly createWorker: WorkerSupervisorOptions["createWorker"];
  private stateValue: WorkerSupervisorState = "stopped";
  private generationValue = 0;
  private activeWorker: ActiveWorker | undefined;
  private readyWaiter: ReadyWaiter | undefined;

  constructor(options: WorkerSupervisorOptions) {
    this.createWorker = options.createWorker;
  }

  get state(): WorkerSupervisorState {
    return this.stateValue;
  }

  get workerGeneration(): number {
    return this.generationValue;
  }

  start(): Promise<void> {
    if (this.stateValue === "ready") {
      return Promise.resolve();
    }
    if (this.stateValue === "starting" && this.readyWaiter !== undefined) {
      return this.readyWaiter.promise;
    }

    this.stateValue = "starting";
    const generation = this.generationValue + 1;
    this.generationValue = generation;

    let resolveReady: () => void = () => undefined;
    let rejectReady: (reason: unknown) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.readyWaiter = { promise, resolve: resolveReady, reject: rejectReady };

    let worker: WorkerLike;
    try {
      worker = this.createWorker(generation);
    } catch (error: unknown) {
      this.fail(
        new WorkerSupervisorError(
          "WORKER_START_FAILED",
          `Failed to create Worker: ${errorMessage(error)}`,
          { cause: error },
        ),
      );
      return promise;
    }

    const activeWorker: ActiveWorker = {
      generation,
      worker,
      onMessage: (event) => this.handleMessage(activeWorker, event.data),
      onError: (event) => this.handleError(activeWorker, event),
    };
    this.activeWorker = activeWorker;

    try {
      worker.addEventListener("message", activeWorker.onMessage);
      worker.addEventListener("error", activeWorker.onError);
    } catch (error: unknown) {
      this.fail(
        new WorkerSupervisorError(
          "WORKER_START_FAILED",
          `Failed to attach Worker listeners: ${errorMessage(error)}`,
          { cause: error },
        ),
      );
    }

    return promise;
  }

  terminate(): void {
    if (this.activeWorker === undefined && this.stateValue === "stopped") {
      return;
    }

    const waiter = this.readyWaiter;
    this.readyWaiter = undefined;
    this.cleanupActiveWorker();
    this.stateValue = "stopped";
    waiter?.reject(new WorkerSupervisorError("TERMINATED", "Worker supervisor was terminated."));
  }

  private handleMessage(activeWorker: ActiveWorker, input: unknown): void {
    if (!this.isCurrent(activeWorker) || this.stateValue !== "starting") {
      return;
    }

    try {
      const decoded = decodeWorkerMessage(input);
      if (decoded.type !== "WorkerReady") {
        throw new ProtocolDecodeError(
          "INVALID_MESSAGE",
          `Expected WorkerReady while starting, received "${decoded.type}".`,
        );
      }
      if (decoded.workerGeneration !== activeWorker.generation) {
        throw new ProtocolDecodeError(
          "INVALID_MESSAGE",
          `WorkerReady generation ${decoded.workerGeneration} does not match ${activeWorker.generation}.`,
        );
      }
    } catch (error: unknown) {
      this.fail(error);
      return;
    }

    this.stateValue = "ready";
    const waiter = this.readyWaiter;
    this.readyWaiter = undefined;
    waiter?.resolve();
  }

  private handleError(activeWorker: ActiveWorker, event: ErrorEvent): void {
    if (!this.isCurrent(activeWorker)) {
      return;
    }

    this.fail(
      new WorkerSupervisorError(
        "WORKER_FAILED",
        `Worker failed: ${event.message || "unknown error"}.`,
      ),
    );
  }

  private fail(error: unknown): void {
    const waiter = this.readyWaiter;
    this.readyWaiter = undefined;
    this.cleanupActiveWorker();
    this.stateValue = "failed";
    waiter?.reject(error);
  }

  private cleanupActiveWorker(): void {
    const activeWorker = this.activeWorker;
    this.activeWorker = undefined;
    if (activeWorker === undefined) {
      return;
    }

    activeWorker.worker.removeEventListener("message", activeWorker.onMessage);
    activeWorker.worker.removeEventListener("error", activeWorker.onError);
    activeWorker.worker.terminate();
  }

  private isCurrent(activeWorker: ActiveWorker): boolean {
    return (
      this.activeWorker === activeWorker &&
      activeWorker.generation === this.generationValue &&
      activeWorker.worker === this.activeWorker?.worker
    );
  }
}

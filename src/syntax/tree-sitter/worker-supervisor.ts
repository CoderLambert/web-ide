import { decodeWorkerMessage, ProtocolDecodeError } from "./protocol";

export type WorkerSupervisorState = "stopped" | "starting" | "ready" | "failed";

export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface OpenDocumentSnapshot {
  documentUri: string;
  sessionId: string;
  languageId: string;
  documentVersion: number;
  text: string;
}

export interface WorkerSupervisorOptions {
  createWorker: (workerGeneration: number) => WorkerLike;
  getOpenDocumentSnapshots?: () => readonly OpenDocumentSnapshot[];
  onWorkerReady?: (worker: WorkerLike, workerGeneration: number) => void | Promise<void>;
  restoreOpenDocuments?: (
    snapshots: readonly OpenDocumentSnapshot[],
    workerGeneration: number,
  ) => void | Promise<void>;
  maxAutoRecoveries?: number;
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
  private readonly getOpenDocumentSnapshots:
    | NonNullable<WorkerSupervisorOptions["getOpenDocumentSnapshots"]>
    | undefined;
  private readonly onWorkerReady: NonNullable<WorkerSupervisorOptions["onWorkerReady"]> | undefined;
  private readonly restoreOpenDocuments:
    | NonNullable<WorkerSupervisorOptions["restoreOpenDocuments"]>
    | undefined;
  private readonly maxAutoRecoveries: number;
  private stateValue: WorkerSupervisorState = "stopped";
  private generationValue = 0;
  private activeWorker: ActiveWorker | undefined;
  private readyWaiter: ReadyWaiter | undefined;
  private autoRecoveryCount = 0;

  constructor(options: WorkerSupervisorOptions) {
    if (
      options.maxAutoRecoveries !== undefined &&
      (!Number.isInteger(options.maxAutoRecoveries) || options.maxAutoRecoveries < 0)
    ) {
      throw new Error("maxAutoRecoveries must be a non-negative integer.");
    }

    this.createWorker = options.createWorker;
    this.getOpenDocumentSnapshots = options.getOpenDocumentSnapshots;
    this.onWorkerReady = options.onWorkerReady;
    this.restoreOpenDocuments = options.restoreOpenDocuments;
    this.maxAutoRecoveries = options.maxAutoRecoveries ?? 1;
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

    this.autoRecoveryCount = 0;
    this.stateValue = "starting";
    return this.launchWorker();
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

    void this.finishReady(activeWorker).catch((error: unknown) => {
      if (this.isCurrent(activeWorker)) {
        this.fail(error);
      }
    });
  }

  private handleError(activeWorker: ActiveWorker, event: ErrorEvent): void {
    if (!this.isCurrent(activeWorker)) {
      return;
    }

    const error = new WorkerSupervisorError(
      "WORKER_FAILED",
      `Worker failed: ${event.message || "unknown error"}.`,
    );
    if (this.autoRecoveryCount >= this.maxAutoRecoveries) {
      this.fail(error);
      return;
    }

    this.autoRecoveryCount += 1;
    this.cleanupActiveWorker();
    this.stateValue = "starting";
    void this.launchWorker().catch(() => undefined);
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

  private launchWorker(): Promise<void> {
    const waiter = this.readyWaiter ?? this.createReadyWaiter();
    const generation = this.generationValue + 1;
    this.generationValue = generation;

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
      return waiter.promise;
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

    return waiter.promise;
  }

  private createReadyWaiter(): ReadyWaiter {
    let resolveReady: () => void = () => undefined;
    let rejectReady: (reason: unknown) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const waiter = { promise, resolve: resolveReady, reject: rejectReady };
    this.readyWaiter = waiter;
    return waiter;
  }

  private async finishReady(activeWorker: ActiveWorker): Promise<void> {
    await this.onWorkerReady?.(activeWorker.worker, activeWorker.generation);
    if (!this.isCurrent(activeWorker) || this.stateValue !== "starting") {
      return;
    }

    const snapshots = this.getOpenDocumentSnapshots?.() ?? [];
    await this.restoreOpenDocuments?.(snapshots, activeWorker.generation);
    if (!this.isCurrent(activeWorker) || this.stateValue !== "starting") {
      return;
    }

    this.stateValue = "ready";
    const waiter = this.readyWaiter;
    this.readyWaiter = undefined;
    waiter?.resolve();
  }
}

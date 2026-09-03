import { Worker } from "node:worker_threads";

import type {
  SqlLabWorkerRequest,
  SqlLabWorkerResponse,
} from "@/server/sql-lab/execution-protocol";
import { SQL_LAB_LIMITS } from "@/server/sql-lab/limits";

export interface SqlLabExecutionHost {
  run(request: SqlLabWorkerRequest): Promise<SqlLabWorkerResponse>;
}

export class SqlLabWorkerExecutionHost implements SqlLabExecutionHost {
  async run(request: SqlLabWorkerRequest): Promise<SqlLabWorkerResponse> {
    const workerUrl = await resolveWorkerEntry();
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl, { workerData: request });
      let settled = false;
      let timeoutId: NodeJS.Timeout | undefined;
      let response: SqlLabWorkerResponse | undefined;
      let workerError: Error | undefined;
      let timedOut = false;
      let terminationRequested = false;

      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        callback();
      };

      const handleExit = (code: number): void => {
        if (timedOut) {
          settle(() => resolve(timeoutResponse(request)));
          return;
        }
        if (workerError !== undefined) {
          settle(() => reject(workerError));
          return;
        }
        if (code !== 0) {
          settle(() => reject(new Error(`SQL Lab worker exited with code ${code}.`)));
          return;
        }
        if (response === undefined) {
          settle(() => reject(new Error("SQL Lab worker exited without a response.")));
          return;
        }
        const completedResponse = response;
        settle(() => resolve(completedResponse));
      };

      const requestTermination = (): void => {
        if (terminationRequested) {
          return;
        }
        terminationRequested = true;
        void worker
          .terminate()
          .then((code) => handleExit(code))
          .catch((error: unknown) => {
            if (workerError === undefined) {
              workerError = error instanceof Error ? error : new Error(String(error));
            }
          });
      };

      worker.once("message", (message: unknown) => {
        if (!isWorkerResponse(message)) {
          workerError = new Error("SQL Lab worker returned an invalid response.");
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
          requestTermination();
          return;
        }
        response = message;
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        requestTermination();
      });
      worker.once("error", (error) => {
        workerError ??= error;
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        requestTermination();
      });
      worker.once("exit", handleExit);

      timeoutId = setTimeout(() => {
        timedOut = true;
        requestTermination();
      }, SQL_LAB_LIMITS.executionTimeoutMs);
    });
  }
}

async function resolveWorkerEntry(): Promise<URL> {
  const workerModule = await import("./sqlite-execution.worker");
  return new URL(workerModule.SQL_LAB_WORKER_ENTRY_URL);
}

function timeoutResponse(request: SqlLabWorkerRequest): SqlLabWorkerResponse {
  if (request.operation === "execute") {
    return {
      ok: true,
      value: {
        operation: "execute",
        execution: {
          status: "timeout",
          results: [],
          executionTimeMs: SQL_LAB_LIMITS.executionTimeoutMs,
          transactionRolledBack: false,
        },
      },
    };
  }
  return {
    ok: false,
    error: { code: "QUERY_TIMEOUT", message: "The SQL operation timed out." },
  };
}

function isWorkerResponse(value: unknown): value is SqlLabWorkerResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.ok === true || record.ok === false;
}

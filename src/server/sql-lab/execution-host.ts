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

      worker.once("message", (message: unknown) => {
        if (!isWorkerResponse(message)) {
          settle(() => reject(new Error("SQL Lab worker returned an invalid response.")));
          void worker.terminate();
          return;
        }
        settle(() => resolve(message));
        void worker.terminate();
      });
      worker.once("error", (error) => {
        settle(() => reject(error));
      });
      worker.once("exit", (code) => {
        if (code !== 0) {
          settle(() => reject(new Error(`SQL Lab worker exited with code ${code}.`)));
        }
      });

      timeoutId = setTimeout(() => {
        settle(() => {
          const termination = worker.terminate();
          void Promise.race([
            termination,
            new Promise((graceResolve) =>
              setTimeout(graceResolve, SQL_LAB_LIMITS.terminationGraceMs),
            ),
          ]).then(() => resolve(timeoutResponse(request)));
        });
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

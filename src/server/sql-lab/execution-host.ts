import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

import type {
  SqlLabWorkerRequest,
  SqlLabWorkerResponse,
} from "@/server/sql-lab/execution-protocol";
import { SQL_LAB_LIMITS } from "@/server/sql-lab/limits";

export interface SqlLabExecutionHost {
  run(request: SqlLabWorkerRequest): Promise<SqlLabWorkerResponse>;
}

export class SqlLabChildProcessExecutionHost implements SqlLabExecutionHost {
  async run(request: SqlLabWorkerRequest): Promise<SqlLabWorkerResponse> {
    const childPath = await resolveChildEntry();
    return new Promise((resolve, reject) => {
      const child = fork(childPath, [], {
        env: {
          ...process.env,
          WEB_IDE_SQL_LAB_CHILD: "1",
        },
        execArgv: process.execArgv.includes("--experimental-strip-types")
          ? process.execArgv
          : [...process.execArgv, "--experimental-strip-types"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      let settled = false;
      let timeoutId: NodeJS.Timeout | undefined;
      let response: SqlLabWorkerResponse | undefined;
      let childError: Error | undefined;
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

      const handleExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (timedOut) {
          settle(() => resolve(timeoutResponse(request)));
          return;
        }
        if (childError !== undefined) {
          settle(() => reject(childError));
          return;
        }
        if (code !== 0 || signal !== null) {
          settle(() => reject(new Error(`SQL Lab child exited with code ${code ?? signal}.`)));
          return;
        }
        if (response === undefined) {
          settle(() => reject(new Error("SQL Lab child exited without a response.")));
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
        child.kill("SIGKILL");
      };

      child.once("message", (message: unknown) => {
        if (!isWorkerResponse(message)) {
          childError = new Error("SQL Lab child returned an invalid response.");
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
      });
      child.once("error", (error) => {
        childError ??= error;
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        requestTermination();
      });
      child.once("exit", handleExit);

      child.send(request, (error) => {
        if (error === undefined || error === null) {
          return;
        }
        childError ??= error;
        requestTermination();
      });

      timeoutId = setTimeout(() => {
        timedOut = true;
        requestTermination();
      }, SQL_LAB_LIMITS.executionTimeoutMs);
    });
  }
}

async function resolveChildEntry(): Promise<string> {
  const childModule = await import("./sqlite-execution.child.ts");
  return fileURLToPath(new URL(childModule.SQL_LAB_CHILD_ENTRY_URL));
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

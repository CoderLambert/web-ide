import { isMainThread, parentPort, workerData } from "node:worker_threads";

import type {
  SqlLabWorkerRequest,
  SqlLabWorkerResponse,
} from "@/server/sql-lab/execution-protocol";
import { SqliteEngine, SqliteEngineError } from "@/server/sql-lab/sqlite-engine";

export const SQL_LAB_WORKER_ENTRY_URL = import.meta.url;

if (!isMainThread) {
  if (parentPort === null) {
    throw new Error("SQL Lab execution worker requires a parent port.");
  }

  const request = workerData as SqlLabWorkerRequest;
  let engine: SqliteEngine | undefined;
  try {
    engine = new SqliteEngine({ databasePath: request.databasePath });
    const response: SqlLabWorkerResponse = execute(request, engine);
    parentPort.postMessage(response);
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: toWorkerError(error),
    } satisfies SqlLabWorkerResponse);
  } finally {
    engine?.close();
  }
}

function execute(request: SqlLabWorkerRequest, sqlite: SqliteEngine): SqlLabWorkerResponse {
  switch (request.operation) {
    case "execute":
      return { ok: true, value: { operation: "execute", execution: sqlite.execute(request.sql) } };
    case "schema":
      return { ok: true, value: { operation: "schema", schema: sqlite.getSchema() } };
    case "explain":
      return {
        ok: true,
        value: { operation: "explain", result: sqlite.explain(request.sql) },
      };
    case "reset":
      return {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "SQL Lab reset is not available yet." },
      };
  }
}

function toWorkerError(error: unknown): {
  code: "DATABASE_UNAVAILABLE" | "INVALID_REQUEST" | "INTERNAL_ERROR";
  message: string;
} {
  if (error instanceof SqliteEngineError) {
    if (error.code === "DATABASE_UNAVAILABLE" || error.code === "INVALID_REQUEST") {
      return { code: error.code, message: error.message };
    }
  }
  return { code: "INTERNAL_ERROR", message: "SQL Lab execution failed." };
}

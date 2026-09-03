import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import type {
  SqlLabWorkerRequest,
  SqlLabWorkerResponse,
} from "@/server/sql-lab/execution-protocol";
import { publicSqlLabError } from "@/server/sql-lab/public-error";
import type { SqliteEngine } from "@/server/sql-lab/sqlite-engine";

export const SQL_LAB_WORKER_ENTRY_URL = import.meta.url;

if (!isMainThread) {
  if (parentPort === null) {
    throw new Error("SQL Lab execution worker requires a parent port.");
  }

  const request = workerData as SqlLabWorkerRequest & { __sqlLabNested?: boolean };
  if (request.__sqlLabNested !== true) {
    const port = parentPort;
    const nestedWorker = new Worker(new URL(import.meta.url), {
      workerData: { ...request, __sqlLabNested: true },
    });
    nestedWorker.once("message", (message: unknown) => port.postMessage(message));
    nestedWorker.once("error", (error) => {
      port.postMessage({
        ok: false,
        error: toWorkerError(error),
      } satisfies SqlLabWorkerResponse);
    });
  } else {
    void runRequest(request);
  }
}

async function runRequest(request: SqlLabWorkerRequest): Promise<void> {
  let engine: SqliteEngine | undefined;
  try {
    const [{ resetSqliteDatabase }, { SqliteEngine }] = await Promise.all([
      import("@/server/sql-lab/reset"),
      import("@/server/sql-lab/sqlite-engine"),
    ]);
    let response: SqlLabWorkerResponse;
    if (request.operation === "reset") {
      response = {
        ok: true,
        value: { operation: "reset", schema: resetSqliteDatabase(request.databasePath) },
      };
    } else {
      engine = new SqliteEngine({ databasePath: request.databasePath });
      response = execute(request, engine);
    }
    parentPort?.postMessage(response);
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      error: toWorkerError(error),
    } satisfies SqlLabWorkerResponse);
  } finally {
    engine?.close();
  }
}

type EngineWorkerRequest = Exclude<SqlLabWorkerRequest, { operation: "reset" }>;

function execute(request: EngineWorkerRequest, sqlite: SqliteEngine): SqlLabWorkerResponse {
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
  }
  throw new Error("Unsupported SQL Lab engine request.");
}

function toWorkerError(error: unknown) {
  return publicSqlLabError(error);
}

import { publicSqlLabError } from "./public-error.ts";
import { resetSqliteDatabase } from "./reset.ts";
import type { SqlLabWorkerRequest, SqlLabWorkerResponse } from "./execution-protocol.ts";
import { SqliteEngine } from "./sqlite-engine.ts";

export const SQL_LAB_CHILD_ENTRY_URL = import.meta.url;

if (process.env.WEB_IDE_SQL_LAB_CHILD === "1") {
  process.once("message", (message: unknown) => {
    void runRequest(message);
  });
}

async function runRequest(message: unknown): Promise<void> {
  let engine: SqliteEngine | undefined;
  try {
    if (!isSqlLabWorkerRequest(message)) {
      throw new Error("SQL Lab child received an invalid request.");
    }

    let response: SqlLabWorkerResponse;
    if (message.operation === "reset") {
      response = {
        ok: true,
        value: { operation: "reset", schema: resetSqliteDatabase(message.databasePath) },
      };
    } else {
      engine = new SqliteEngine({ databasePath: message.databasePath });
      response = execute(message, engine);
    }
    sendResponse(response);
  } catch (error) {
    sendResponse({
      ok: false,
      error: publicSqlLabError(error),
    });
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
}

function sendResponse(response: SqlLabWorkerResponse): void {
  if (process.send === undefined) {
    return;
  }

  process.send(response, (error) => {
    if (error !== null) {
      process.exitCode = 1;
    }
    process.disconnect?.();
  });
}

function isSqlLabWorkerRequest(value: unknown): value is SqlLabWorkerRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const request = value as Record<string, unknown>;
  if (typeof request.databasePath !== "string" || typeof request.operation !== "string") {
    return false;
  }

  return (
    request.operation === "schema" ||
    request.operation === "reset" ||
    ((request.operation === "execute" || request.operation === "explain") &&
      typeof request.sql === "string")
  );
}

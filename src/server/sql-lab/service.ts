import type { SqlLabError, SqlLabRequest, SqlLabResponse } from "@/sql-lab/contract";
import type { SqlLabWorkerRequest } from "@/server/sql-lab/execution-protocol";
import { SqliteEngineError } from "@/server/sql-lab/sqlite-engine";
import {
  SqlLabWorkerExecutionHost,
  type SqlLabExecutionHost,
} from "@/server/sql-lab/execution-host";

export interface SqlLabServiceOptions {
  databasePath: string;
  executionHost?: SqlLabExecutionHost;
}

export class SqlLabService {
  readonly #databasePath: string;
  readonly #executionHost: SqlLabExecutionHost;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: SqlLabServiceOptions) {
    this.#databasePath = options.databasePath;
    this.#executionHost = options.executionHost ?? new SqlLabWorkerExecutionHost();
  }

  run(request: SqlLabRequest): Promise<SqlLabResponse> {
    const job = this.#queue.then(() => this.runOne(request));
    this.#queue = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  private async runOne(request: SqlLabRequest): Promise<SqlLabResponse> {
    const workerRequest = toWorkerRequest(request, this.#databasePath);
    try {
      const response = await this.#executionHost.run(workerRequest);
      return response;
    } catch {
      return { ok: false, error: internalError() };
    }
  }
}

function toWorkerRequest(request: SqlLabRequest, databasePath: string): SqlLabWorkerRequest {
  switch (request.operation) {
    case "execute":
      return { operation: "execute", databasePath, sql: request.sql };
    case "schema":
      return { operation: "schema", databasePath };
    case "explain":
      return { operation: "explain", databasePath, sql: request.sql };
    case "reset":
      return { operation: "reset", databasePath };
  }
}

function internalError(): SqlLabError {
  return { code: "INTERNAL_ERROR", message: "SQL Lab execution failed." };
}

export function publicSqlLabError(error: unknown): SqlLabError {
  if (error instanceof SqliteEngineError) {
    switch (error.code) {
      case "INVALID_REQUEST":
      case "NO_EXECUTABLE_STATEMENT":
      case "STATEMENT_LIMIT":
      case "RESULT_LIMIT":
      case "QUERY_TIMEOUT":
      case "SQL_ERROR":
        return { code: error.code, message: error.message };
      case "DATABASE_UNAVAILABLE":
        return { code: error.code, message: "The SQL Lab database is unavailable." };
      default:
        return internalError();
    }
  }
  return internalError();
}

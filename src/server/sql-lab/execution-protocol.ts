import type {
  QueryStatementResult,
  SqlExecutionReport,
  SqlLabError,
  SqlSchema,
} from "#/sql-lab/contract.ts";

export type SqlLabWorkerRequest =
  | { operation: "execute"; databasePath: string; sql: string }
  | { operation: "schema"; databasePath: string }
  | { operation: "explain"; databasePath: string; sql: string }
  | { operation: "reset"; databasePath: string };

export type SqlLabWorkerValue =
  | { operation: "execute"; execution: SqlExecutionReport }
  | { operation: "schema"; schema: SqlSchema }
  | { operation: "explain"; result: QueryStatementResult }
  | { operation: "reset"; schema: SqlSchema };

export type SqlLabWorkerResponse =
  | { ok: true; value: SqlLabWorkerValue }
  | { ok: false; error: SqlLabError };

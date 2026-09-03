import type { SqlLabError, SqlLabRequest, SqlLabResponse } from "@/sql-lab/contract";
import { SQL_LAB_DEFAULT_ENDPOINT, SQL_LAB_OPERATIONS } from "@/sql-lab/config";

const SQL_LAB_ERROR_CODES = [
  "INVALID_REQUEST",
  "FORBIDDEN",
  "DATABASE_UNAVAILABLE",
  "NO_EXECUTABLE_STATEMENT",
  "STATEMENT_LIMIT",
  "RESULT_LIMIT",
  "QUERY_TIMEOUT",
  "SQL_ERROR",
  "INTERNAL_ERROR",
] as const;

const SQL_LAB_STATEMENT_ERROR_CODES = [
  "SQL_ERROR",
  "QUERY_TIMEOUT",
  "STATEMENT_LIMIT",
  "RESULT_LIMIT",
] as const;

export type SqlLabFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SqlLabClientOptions {
  workspaceId: string;
  endpoint?: string;
  fetch?: SqlLabFetch;
}

export class SqlLabClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlLabClientError";
  }
}

export class SqlLabClient {
  readonly #workspaceId: string;
  readonly #endpoint: string;
  readonly #fetch: SqlLabFetch;

  constructor(options: SqlLabClientOptions) {
    this.#workspaceId = options.workspaceId;
    this.#endpoint = options.endpoint ?? SQL_LAB_DEFAULT_ENDPOINT;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  execute(sql: string): Promise<SqlLabResponse> {
    return this.request({ operation: "execute", workspaceId: this.#workspaceId, sql });
  }

  schema(): Promise<SqlLabResponse> {
    return this.request({ operation: "schema", workspaceId: this.#workspaceId });
  }

  explain(sql: string): Promise<SqlLabResponse> {
    return this.request({ operation: "explain", workspaceId: this.#workspaceId, sql });
  }

  reset(): Promise<SqlLabResponse> {
    return this.request({ operation: "reset", workspaceId: this.#workspaceId });
  }

  private async request(payload: SqlLabRequest): Promise<SqlLabResponse> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
    } catch {
      throw new SqlLabClientError("SQL Lab request failed.");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SqlLabClientError("SQL Lab returned an invalid response.");
    }
    if (!isSqlLabResponse(body)) {
      throw new SqlLabClientError("SQL Lab returned an invalid response.");
    }
    return body;
  }
}

function isSqlLabResponse(value: unknown): value is SqlLabResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }
  if (value.ok) {
    return hasExactKeys(value, ["ok", "value"]) && isSuccessValue(value.value);
  }
  return hasExactKeys(value, ["ok", "error"]) && isError(value.error);
}

function isSuccessValue(value: unknown): boolean {
  if (!isRecord(value) || typeof value.operation !== "string") {
    return false;
  }
  if (!SQL_LAB_OPERATIONS.some((operation) => operation === value.operation)) {
    return false;
  }
  switch (value.operation) {
    case "execute":
      return hasExactKeys(value, ["operation", "execution"]) && isExecutionReport(value.execution);
    case "schema":
      return hasExactKeys(value, ["operation", "schema"]) && isSchema(value.schema);
    case "explain":
      return hasExactKeys(value, ["operation", "result"]) && isQueryResult(value.result);
    case "reset":
      return hasExactKeys(value, ["operation", "schema"]) && isSchema(value.schema);
  }
  return false;
}

function isExecutionReport(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["status", "results", "executionTimeMs", "transactionRolledBack"]) &&
    (value.status === "completed" || value.status === "failed" || value.status === "timeout") &&
    Array.isArray(value.results) &&
    value.results.every(isStatementResult) &&
    isNonNegativeFiniteNumber(value.executionTimeMs) &&
    typeof value.transactionRolledBack === "boolean"
  );
}

function isStatementResult(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }
  switch (value.kind) {
    case "query":
      return isQueryResult(value);
    case "change":
      return (
        hasExactKeys(value, [
          "kind",
          "statementIndex",
          "statementPreview",
          "affectedRows",
          "executionTimeMs",
        ]) &&
        isNonNegativeInteger(value.statementIndex) &&
        typeof value.statementPreview === "string" &&
        isNonNegativeInteger(value.affectedRows) &&
        isNonNegativeFiniteNumber(value.executionTimeMs)
      );
    case "error":
      return (
        hasExactKeys(value, [
          "kind",
          "statementIndex",
          "statementPreview",
          "code",
          "message",
          "executionTimeMs",
        ]) &&
        isNonNegativeInteger(value.statementIndex) &&
        typeof value.statementPreview === "string" &&
        isStatementErrorCode(value.code) &&
        typeof value.message === "string" &&
        isNonNegativeFiniteNumber(value.executionTimeMs)
      );
    default:
      return false;
  }
}

function isQueryResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasRequiredKeys(
      value,
      [
        "kind",
        "statementIndex",
        "statementPreview",
        "columns",
        "rows",
        "returnedRowCount",
        "truncated",
        "executionTimeMs",
      ],
      ["truncationReason"],
    ) &&
    value.kind === "query" &&
    isNonNegativeInteger(value.statementIndex) &&
    typeof value.statementPreview === "string" &&
    Array.isArray(value.columns) &&
    value.columns.every(isResultColumn) &&
    Array.isArray(value.rows) &&
    value.rows.every((row) => Array.isArray(row) && row.every(isSqlValue)) &&
    isNonNegativeInteger(value.returnedRowCount) &&
    typeof value.truncated === "boolean" &&
    (value.truncationReason === undefined ||
      value.truncationReason === "row_limit" ||
      value.truncationReason === "byte_limit") &&
    isNonNegativeFiniteNumber(value.executionTimeMs)
  );
}

function isResultColumn(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["name", "declaredType"]) &&
    typeof value.name === "string" &&
    (value.declaredType === null || typeof value.declaredType === "string")
  );
}

function isSchema(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["tables"]) &&
    Array.isArray(value.tables) &&
    value.tables.every(isTableSchema)
  );
}

function isTableSchema(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["name", "columns", "indexes"]) &&
    typeof value.name === "string" &&
    Array.isArray(value.columns) &&
    value.columns.every(isColumnSchema) &&
    Array.isArray(value.indexes) &&
    value.indexes.every(isIndexSchema)
  );
}

function isColumnSchema(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "name",
      "declaredType",
      "nullable",
      "primaryKeyPosition",
      "defaultValue",
    ]) &&
    typeof value.name === "string" &&
    (value.declaredType === null || typeof value.declaredType === "string") &&
    typeof value.nullable === "boolean" &&
    isNonNegativeInteger(value.primaryKeyPosition) &&
    (value.defaultValue === null || typeof value.defaultValue === "string")
  );
}

function isIndexSchema(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["name", "unique", "columns"]) &&
    typeof value.name === "string" &&
    typeof value.unique === "boolean" &&
    Array.isArray(value.columns) &&
    value.columns.every((column) => typeof column === "string")
  );
}

function isSqlValue(value: unknown): boolean {
  if (value === null || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }
  switch (value.kind) {
    case "integer64":
      return hasExactKeys(value, ["kind", "value"]) && typeof value.value === "string";
    case "blob":
      return hasExactKeys(value, ["kind", "byteLength"]) && isNonNegativeInteger(value.byteLength);
    case "text":
      return (
        hasExactKeys(value, ["kind", "value", "originalByteLength", "truncated"]) &&
        typeof value.value === "string" &&
        isNonNegativeInteger(value.originalByteLength) &&
        value.truncated === true
      );
    default:
      return false;
  }
}

function isError(value: unknown): value is SqlLabError {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasExactKeys(value, ["code", "message"]) &&
    isErrorCode(value.code) &&
    typeof value.message === "string"
  );
}

function isErrorCode(value: unknown): value is SqlLabError["code"] {
  return typeof value === "string" && SQL_LAB_ERROR_CODES.some((code) => code === value);
}

function isStatementErrorCode(value: unknown): boolean {
  return typeof value === "string" && SQL_LAB_STATEMENT_ERROR_CODES.some((code) => code === value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function hasRequiredKeys(
  record: Record<string, unknown>,
  required: string[],
  optional: string[],
): boolean {
  const allowed = [...required, ...optional];
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(record, key)) &&
    Object.keys(record).every((key) => allowed.includes(key))
  );
}

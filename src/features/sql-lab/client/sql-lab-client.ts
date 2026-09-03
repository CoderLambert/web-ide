import type { SqlLabError, SqlLabRequest, SqlLabResponse } from "@/sql-lab/contract";
import { SQL_LAB_DEFAULT_ENDPOINT, SQL_LAB_OPERATIONS } from "@/sql-lab/config";

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
    const responseValue = value.value;
    return (
      hasExactKeys(value, ["ok", "value"]) &&
      isRecord(responseValue) &&
      typeof responseValue.operation === "string" &&
      SQL_LAB_OPERATIONS.some((operation) => operation === responseValue.operation)
    );
  }
  return hasExactKeys(value, ["ok", "error"]) && isError(value.error);
}

function isError(value: unknown): value is SqlLabError {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.code === "string" && typeof value.message === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

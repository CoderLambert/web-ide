import type { SqlLabError, SqlLabRequest, SqlLabResponse } from "@/sql-lab/contract";

export interface SqlLabServiceLike {
  run(request: SqlLabRequest): Promise<SqlLabResponse>;
}

export interface SqlLabApiDependencies {
  authorize(workspaceId: string): Promise<void> | void;
  service: SqlLabServiceLike;
}

export async function handleSqlLabApiRequest(
  request: Request,
  dependencies: SqlLabApiDependencies,
): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return failureResponse("INVALID_REQUEST", "Only POST is supported.", 405);
    }
    const payload = decodeRequest(await readJson(request));
    await dependencies.authorize(payload.workspaceId);
    const response = await dependencies.service.run(payload);
    return Response.json(response, { status: response.ok ? 200 : statusFor(response.error.code) });
  } catch (error) {
    if (isApiError(error)) {
      return failureResponse(error.code, error.message, statusFor(error.code));
    }
    return failureResponse("INTERNAL_ERROR", "SQL Lab request failed.", 500);
  }
}

function decodeRequest(input: unknown): SqlLabRequest {
  if (!isRecord(input) || typeof input.workspaceId !== "string" || input.workspaceId === "") {
    throw apiError("INVALID_REQUEST", "Invalid SQL Lab request.");
  }
  if (typeof input.operation !== "string") {
    throw apiError("INVALID_REQUEST", "Invalid SQL Lab request.");
  }

  const workspaceId = input.workspaceId;
  switch (input.operation) {
    case "execute":
    case "explain":
      exactKeys(input, ["operation", "workspaceId", "sql"]);
      if (typeof input.sql !== "string") {
        throw apiError("INVALID_REQUEST", "Invalid SQL Lab request.");
      }
      return { operation: input.operation, workspaceId, sql: input.sql };
    case "schema":
    case "reset":
      exactKeys(input, ["operation", "workspaceId"]);
      return { operation: input.operation, workspaceId };
    default:
      throw apiError("INVALID_REQUEST", "Invalid SQL Lab request.");
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw apiError("INVALID_REQUEST", "Invalid SQL Lab request.");
  }
}

function exactKeys(record: Record<string, unknown>, expected: string[]): void {
  const keys = Object.keys(record);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw apiError("INVALID_REQUEST", "Invalid SQL Lab request.");
  }
}

function failureResponse(code: SqlLabError["code"], message: string, status: number): Response {
  const response: SqlLabResponse = { ok: false, error: { code, message } };
  return Response.json(response, { status });
}

function statusFor(code: SqlLabError["code"]): number {
  switch (code) {
    case "FORBIDDEN":
      return 403;
    case "DATABASE_UNAVAILABLE":
      return 503;
    case "INTERNAL_ERROR":
      return 500;
    case "QUERY_TIMEOUT":
      return 408;
    case "INVALID_REQUEST":
      return 400;
    case "NO_EXECUTABLE_STATEMENT":
    case "STATEMENT_LIMIT":
    case "RESULT_LIMIT":
    case "SQL_ERROR":
      return 422;
  }
}

class SqlLabApiError extends Error {
  constructor(
    readonly code: SqlLabError["code"],
    message: string,
  ) {
    super(message);
  }
}

function apiError(code: SqlLabError["code"], message: string): SqlLabApiError {
  return new SqlLabApiError(code, message);
}

function isApiError(error: unknown): error is SqlLabApiError {
  return (
    error instanceof SqlLabApiError ||
    (isRecord(error) && typeof error.message === "string" && error.code === "FORBIDDEN")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

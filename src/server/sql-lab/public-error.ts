import type { SqlLabError, SqlLabErrorCode } from "@/sql-lab/contract";

const PUBLIC_SQLITE_ERROR_CODES = [
  "INVALID_REQUEST",
  "NO_EXECUTABLE_STATEMENT",
  "STATEMENT_LIMIT",
  "RESULT_LIMIT",
  "QUERY_TIMEOUT",
  "SQL_ERROR",
] as const;

export function publicSqlLabError(error: unknown): SqlLabError {
  const code = isRecord(error) && isSqlLabErrorCode(error.code) ? error.code : undefined;
  const message = isRecord(error) && typeof error.message === "string" ? error.message : undefined;
  if (code === "DATABASE_UNAVAILABLE") {
    return { code, message: "The SQL Lab database is unavailable." };
  }
  if (code !== undefined && PUBLIC_SQLITE_ERROR_CODES.some((candidate) => candidate === code)) {
    return { code, message: message ?? "SQL Lab execution failed." };
  }
  return { code: "INTERNAL_ERROR", message: "SQL Lab execution failed." };
}

function isSqlLabErrorCode(value: unknown): value is SqlLabErrorCode {
  return (
    typeof value === "string" &&
    [
      "INVALID_REQUEST",
      "FORBIDDEN",
      "DATABASE_UNAVAILABLE",
      "NO_EXECUTABLE_STATEMENT",
      "STATEMENT_LIMIT",
      "RESULT_LIMIT",
      "QUERY_TIMEOUT",
      "SQL_ERROR",
      "INTERNAL_ERROR",
    ].includes(value as SqlLabErrorCode)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

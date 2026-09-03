export type SqlLabErrorCode =
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "DATABASE_UNAVAILABLE"
  | "NO_EXECUTABLE_STATEMENT"
  | "STATEMENT_LIMIT"
  | "RESULT_LIMIT"
  | "QUERY_TIMEOUT"
  | "SQL_ERROR"
  | "INTERNAL_ERROR";

export interface SqlLabError {
  code: SqlLabErrorCode;
  message: string;
}

export type SqlValue =
  | null
  | string
  | number
  | { kind: "integer64"; value: string }
  | { kind: "blob"; byteLength: number }
  | {
      kind: "text";
      value: string;
      originalByteLength: number;
      truncated: true;
    };

export interface SqlResultColumn {
  name: string;
  declaredType: string | null;
}

export interface QueryStatementResult {
  kind: "query";
  statementIndex: number;
  statementPreview: string;
  columns: SqlResultColumn[];
  rows: SqlValue[][];
  returnedRowCount: number;
  truncated: boolean;
  truncationReason?: "row_limit" | "byte_limit";
  executionTimeMs: number;
}

export interface ChangeStatementResult {
  kind: "change";
  statementIndex: number;
  statementPreview: string;
  affectedRows: number;
  executionTimeMs: number;
}

export interface ErrorStatementResult {
  kind: "error";
  statementIndex: number;
  statementPreview: string;
  code: "SQL_ERROR" | "QUERY_TIMEOUT" | "STATEMENT_LIMIT" | "RESULT_LIMIT";
  message: string;
  executionTimeMs: number;
}

export type SqlStatementResult =
  | QueryStatementResult
  | ChangeStatementResult
  | ErrorStatementResult;

export interface SqlExecutionReport {
  status: "completed" | "failed" | "timeout";
  results: SqlStatementResult[];
  executionTimeMs: number;
  transactionRolledBack: boolean;
}

export interface SqlColumnSchema {
  name: string;
  declaredType: string | null;
  nullable: boolean;
  primaryKeyPosition: number;
  defaultValue: string | null;
}

export interface SqlIndexSchema {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface SqlTableSchema {
  name: string;
  columns: SqlColumnSchema[];
  indexes: SqlIndexSchema[];
}

export interface SqlSchema {
  tables: SqlTableSchema[];
}

export type SqlLabRequest =
  | { operation: "execute"; workspaceId: string; sql: string }
  | { operation: "schema"; workspaceId: string }
  | { operation: "explain"; workspaceId: string; sql: string }
  | { operation: "reset"; workspaceId: string };

export type SqlLabResponse =
  | {
      ok: true;
      value:
        | { operation: "execute"; execution: SqlExecutionReport }
        | { operation: "schema"; schema: SqlSchema }
        | { operation: "explain"; result: QueryStatementResult }
        | { operation: "reset"; schema: SqlSchema };
    }
  | { ok: false; error: SqlLabError };

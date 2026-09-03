import { describe, expect, it } from "vite-plus/test";

import type {
  QueryStatementResult,
  SqlLabRequest,
  SqlLabResponse,
  SqlValue,
} from "@/sql-lab/contract";
import { SQL_LAB_DEFAULT_ENDPOINT, SQL_LAB_OPERATIONS } from "@/sql-lab/config";
import { SQL_LAB_LIMITS } from "@/server/sql-lab/limits";

describe("SQL Lab contracts", () => {
  it("keeps the public operation set and endpoint explicit", () => {
    expect(SQL_LAB_DEFAULT_ENDPOINT).toBe("/api/sql-lab");
    expect(SQL_LAB_OPERATIONS).toEqual(["execute", "schema", "explain", "reset"]);
  });

  it("represents values and results without transport-only runtime objects", () => {
    const values: SqlValue[] = [
      null,
      "Alice",
      42,
      { kind: "integer64", value: "9223372036854775807" },
      { kind: "blob", byteLength: 3 },
      {
        kind: "text",
        value: "truncated",
        originalByteLength: 70_000,
        truncated: true,
      },
    ];
    const result: QueryStatementResult = {
      kind: "query",
      statementIndex: 0,
      statementPreview: "SELECT 1",
      columns: [{ name: "value", declaredType: null }],
      rows: [values],
      returnedRowCount: 1,
      truncated: false,
      executionTimeMs: 1,
    };
    const request: SqlLabRequest = {
      operation: "execute",
      workspaceId: "demo",
      sql: "SELECT 1",
    };
    const response: SqlLabResponse = {
      ok: true,
      value: {
        operation: "execute",
        execution: {
          status: "completed",
          results: [result],
          executionTimeMs: 1,
          transactionRolledBack: false,
        },
      },
    };

    expect(request.operation).toBe(response.ok ? response.value.operation : "");
    expect(result.rows[0]).toHaveLength(6);
  });

  it("publishes concrete server-side budgets", () => {
    expect(SQL_LAB_LIMITS).toEqual({
      maxSqlBytes: 1024 * 1024,
      maxStatements: 50,
      maxRowsPerResult: 1000,
      maxTotalRows: 5000,
      maxTextCellBytes: 64 * 1024,
      maxResultBytes: 4 * 1024 * 1024,
      maxDatabaseBytes: 64 * 1024 * 1024,
      executionTimeoutMs: 5000,
      terminationGraceMs: 1000,
    });
  });
});

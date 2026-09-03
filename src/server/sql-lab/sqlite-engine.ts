import { Buffer } from "node:buffer";
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type {
  QueryStatementResult,
  SqlColumnSchema,
  SqlExecutionReport,
  SqlLabErrorCode,
  SqlResultColumn,
  SqlSchema,
  SqlStatementResult,
  SqlTableSchema,
  SqlValue,
} from "@/sql-lab/contract";
import { SQL_LAB_LIMITS } from "@/server/sql-lab/limits";
import { createSqliteAuthorizer } from "@/server/sql-lab/security";

type SqliteRow = unknown[];

const SQLITE_OPTIONS = {
  allowBareNamedParameters: false,
  allowExtension: false,
  allowUnknownNamedParameters: false,
  defensive: true,
  enableDoubleQuotedStringLiterals: false,
  enableForeignKeyConstraints: true,
  readBigInts: true,
  returnArrays: true,
  timeout: 250,
} as const;

const toSafeNumber = (value: number | bigint): number => Number(value);

const toSqlValue = (value: unknown): SqlValue => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value))
      ? Number(value)
      : { kind: "integer64", value: value.toString(10) };
  }

  if (typeof value === "number" || typeof value === "string") {
    if (typeof value === "string") {
      const originalByteLength = Buffer.byteLength(value, "utf8");
      if (originalByteLength > SQL_LAB_LIMITS.maxTextCellBytes) {
        return {
          kind: "text",
          value: Buffer.from(value, "utf8")
            .subarray(0, SQL_LAB_LIMITS.maxTextCellBytes)
            .toString("utf8"),
          originalByteLength,
          truncated: true,
        };
      }
    }
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return { kind: "blob", byteLength: value.byteLength };
  }

  throw new Error("SQLite returned an unsupported value type");
};

const jsonByteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

const statementPreview = (sql: string): string => sql.trim().slice(0, 160);

const isNoStatementError = (error: unknown): boolean =>
  error instanceof Error && error.message === "statement has been finalized";

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && /interrupt|timeout|timed out/i.test(error.message);

const createErrorResult = (
  statementIndex: number,
  sql: string,
  code: "SQL_ERROR" | "QUERY_TIMEOUT" | "STATEMENT_LIMIT" | "RESULT_LIMIT",
  message: string,
  executionTimeMs = 0,
): SqlStatementResult => ({
  kind: "error",
  statementIndex,
  statementPreview: statementPreview(sql),
  code,
  message,
  executionTimeMs,
});

const rowValue = (row: SqliteRow, index: number): unknown => row[index];

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

export class SqliteEngineError extends Error {
  readonly code: SqlLabErrorCode;

  constructor(code: SqlLabErrorCode, message: string) {
    super(message);
    this.name = "SqliteEngineError";
    this.code = code;
  }
}

export interface SqliteEngineOptions {
  databasePath: string;
}

export class SqliteEngine {
  private readonly database: DatabaseSync;

  constructor(options: SqliteEngineOptions) {
    try {
      this.assertDatabaseSize(options.databasePath);
      this.database = new DatabaseSync(options.databasePath, SQLITE_OPTIONS);
      this.configureDatabase();
      this.database.setAuthorizer(createSqliteAuthorizer());
    } catch (error) {
      if (error instanceof SqliteEngineError) {
        throw error;
      }
      throw new SqliteEngineError(
        "DATABASE_UNAVAILABLE",
        error instanceof Error ? error.message : "Unable to open the SQLite database",
      );
    }
  }

  execute(sql: string): SqlExecutionReport {
    this.assertSqlSize(sql);
    const startedAt = performance.now();
    const results: SqlStatementResult[] = [];
    let remaining = sql;
    let statementIndex = 0;
    let totalRows = 0;
    let resultBytes = 0;
    let status: SqlExecutionReport["status"] = "completed";
    let budgetExhausted = false;

    while (true) {
      if (budgetExhausted) {
        results.push(
          createErrorResult(
            statementIndex,
            remaining,
            "RESULT_LIMIT",
            "The result budget was exhausted before this statement could run.",
          ),
        );
        status = "failed";
        break;
      }

      let statement;
      let sourceSQL: string;
      try {
        statement = this.database.prepare(remaining);
        sourceSQL = statement.sourceSQL;
      } catch (error) {
        if (isNoStatementError(error)) {
          break;
        }
        results.push(
          createErrorResult(
            statementIndex,
            remaining,
            isTimeoutError(error) ? "QUERY_TIMEOUT" : "SQL_ERROR",
            error instanceof Error ? error.message : "Unable to prepare SQL",
          ),
        );
        status = isTimeoutError(error) ? "timeout" : "failed";
        break;
      }

      if (statementIndex >= SQL_LAB_LIMITS.maxStatements) {
        results.push(
          createErrorResult(
            statementIndex,
            sourceSQL,
            "STATEMENT_LIMIT",
            `A maximum of ${SQL_LAB_LIMITS.maxStatements} statements may run at once.`,
          ),
        );
        status = "failed";
        break;
      }

      if (sourceSQL.length === 0) {
        break;
      }
      remaining = remaining.slice(sourceSQL.length);

      const statementStartedAt = performance.now();
      try {
        const columns = statement.columns();
        if (columns.length > 0) {
          const queryResult = this.readQueryResult(
            statement,
            statementIndex,
            sourceSQL,
            columns,
            totalRows,
            resultBytes,
          );
          totalRows += queryResult.returnedRowCount;
          resultBytes += queryResult.resultBytes;
          results.push({
            ...queryResult.result,
            executionTimeMs: performance.now() - statementStartedAt,
          });
          if (queryResult.budgetExhausted) {
            budgetExhausted = true;
          }
        } else {
          const changes = statement.run().changes;
          results.push({
            kind: "change",
            statementIndex,
            statementPreview: statementPreview(sourceSQL),
            affectedRows: toSafeNumber(changes),
            executionTimeMs: performance.now() - statementStartedAt,
          });
        }
      } catch (error) {
        results.push(
          createErrorResult(
            statementIndex,
            sourceSQL,
            isTimeoutError(error) ? "QUERY_TIMEOUT" : "SQL_ERROR",
            error instanceof Error ? error.message : "Unable to execute SQL",
            performance.now() - statementStartedAt,
          ),
        );
        status = isTimeoutError(error) ? "timeout" : "failed";
        break;
      }

      statementIndex += 1;
    }

    const transactionRolledBack = this.rollbackOpenTransaction();
    if (statementIndex === 0 && results.length === 0) {
      throw new SqliteEngineError(
        "NO_EXECUTABLE_STATEMENT",
        "SQL does not contain an executable statement.",
      );
    }
    return {
      status,
      results,
      executionTimeMs: performance.now() - startedAt,
      transactionRolledBack,
    };
  }

  explain(sql: string): QueryStatementResult {
    this.assertSqlSize(sql);
    const wrappedSql = `EXPLAIN QUERY PLAN ${sql}`;
    let statement;
    try {
      statement = this.database.prepare(wrappedSql);
    } catch (error) {
      throw new SqliteEngineError(
        isTimeoutError(error) ? "QUERY_TIMEOUT" : "SQL_ERROR",
        error instanceof Error ? error.message : "Unable to prepare query plan",
      );
    }

    const columns = statement.columns();
    const startedAt = performance.now();
    const rows = Array.from(statement.iterate() as unknown as Iterable<SqliteRow>).map((row) =>
      row.map(toSqlValue),
    );
    return {
      kind: "query",
      statementIndex: 0,
      statementPreview: statementPreview(sql),
      columns: columns.map((column) => ({
        name: column.name,
        declaredType: column.type,
      })),
      rows,
      returnedRowCount: rows.length,
      truncated: false,
      executionTimeMs: performance.now() - startedAt,
    };
  }

  getSchema(): SqlSchema {
    const tables = this.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as unknown as SqliteRow[];

    return {
      tables: tables.map((tableRow) => this.readTableSchema(String(rowValue(tableRow, 0)))),
    };
  }

  health(): boolean {
    const result = this.database.prepare("PRAGMA quick_check").all() as unknown as SqliteRow[];
    return result.length === 1 && rowValue(result[0] ?? [], 0) === "ok";
  }

  close(): void {
    if (this.database.isOpen) {
      this.database.close();
    }
  }

  private readQueryResult(
    statement: ReturnType<DatabaseSync["prepare"]>,
    statementIndex: number,
    sourceSQL: string,
    columns: ReturnType<ReturnType<DatabaseSync["prepare"]>["columns"]>,
    totalRows: number,
    resultBytes: number,
  ): {
    result: Omit<QueryStatementResult, "executionTimeMs">;
    returnedRowCount: number;
    resultBytes: number;
    budgetExhausted: boolean;
  } {
    const rows: SqlValue[][] = [];
    let bytes = 0;
    let truncated = false;
    let truncationReason: QueryStatementResult["truncationReason"];
    const iterator = statement.iterate() as unknown as IterableIterator<SqliteRow>;

    while (rows.length < SQL_LAB_LIMITS.maxRowsPerResult) {
      if (totalRows + rows.length >= SQL_LAB_LIMITS.maxTotalRows) {
        truncated = true;
        truncationReason = "row_limit";
        break;
      }

      const next = iterator.next();
      if (next.done) {
        break;
      }

      const row = next.value.map(toSqlValue);
      const rowBytes = jsonByteLength(row);
      if (resultBytes + bytes + rowBytes > SQL_LAB_LIMITS.maxResultBytes) {
        truncated = true;
        truncationReason = "byte_limit";
        break;
      }
      rows.push(row);
      bytes += rowBytes;
    }

    if (!truncated && rows.length >= SQL_LAB_LIMITS.maxRowsPerResult) {
      truncated = !iterator.next().done;
      if (truncated) {
        truncationReason = "row_limit";
      }
    }

    const budgetExhausted =
      resultBytes + bytes >= SQL_LAB_LIMITS.maxResultBytes ||
      totalRows + rows.length >= SQL_LAB_LIMITS.maxTotalRows;
    return {
      result: {
        kind: "query",
        statementIndex,
        statementPreview: statementPreview(sourceSQL),
        columns: columns.map((column): SqlResultColumn => ({
          name: column.name,
          declaredType: column.type,
        })),
        rows,
        returnedRowCount: rows.length,
        truncated,
        ...(truncationReason ? { truncationReason } : {}),
      },
      returnedRowCount: rows.length,
      resultBytes: bytes,
      budgetExhausted,
    };
  }

  private readTableSchema(name: string): SqlTableSchema {
    const tableInfo = this.database
      .prepare(`PRAGMA table_xinfo(${quoteIdentifier(name)})`)
      .all() as unknown as SqliteRow[];
    const indexes = this.database
      .prepare(`PRAGMA index_list(${quoteIdentifier(name)})`)
      .all() as unknown as SqliteRow[];

    const columns: SqlColumnSchema[] = tableInfo
      .filter((row) => Number(rowValue(row, 6) ?? 0) === 0)
      .map((row) => ({
        name: String(rowValue(row, 1)),
        declaredType: rowValue(row, 2) === null ? null : String(rowValue(row, 2)),
        nullable: Number(rowValue(row, 3)) === 0,
        primaryKeyPosition: Number(rowValue(row, 5)),
        defaultValue: rowValue(row, 4) === null ? null : String(rowValue(row, 4)),
      }));

    return {
      name,
      columns,
      indexes: indexes.map((row) => {
        const indexName = String(rowValue(row, 1));
        const indexColumns = this.database
          .prepare(`PRAGMA index_info(${quoteIdentifier(indexName)})`)
          .all() as unknown as SqliteRow[];
        return {
          name: indexName,
          unique: Number(rowValue(row, 2)) === 1,
          columns: indexColumns.map((indexRow) =>
            rowValue(indexRow, 2) === null ? "(expression)" : String(rowValue(indexRow, 2)),
          ),
        };
      }),
    };
  }

  private configureDatabase(): void {
    this.database.enableLoadExtension(false);
    this.database.enableDefensive(true);
    this.database.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA temp_store = MEMORY;",
    );

    const pageSizeRow = this.database.prepare("PRAGMA page_size").get() as unknown as
      | SqliteRow
      | undefined;
    const pageSize = Number(rowValue(pageSizeRow ?? [], 0));
    if (Number.isInteger(pageSize) && pageSize > 0) {
      const maxPageCount = Math.floor(SQL_LAB_LIMITS.maxDatabaseBytes / pageSize);
      this.database.exec(`PRAGMA max_page_count = ${maxPageCount}`);
    }
  }

  private assertDatabaseSize(databasePath: string): void {
    try {
      const stats = statSync(databasePath);
      if (!stats.isFile()) {
        throw new SqliteEngineError(
          "DATABASE_UNAVAILABLE",
          "The configured SQLite database path is not a file.",
        );
      }
      if (stats.size > SQL_LAB_LIMITS.maxDatabaseBytes) {
        throw new SqliteEngineError(
          "DATABASE_UNAVAILABLE",
          `The SQLite database exceeds the ${SQL_LAB_LIMITS.maxDatabaseBytes}-byte limit.`,
        );
      }
    } catch (error) {
      if (error instanceof SqliteEngineError) {
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private assertSqlSize(sql: string): void {
    if (Buffer.byteLength(sql, "utf8") > SQL_LAB_LIMITS.maxSqlBytes) {
      throw new SqliteEngineError(
        "INVALID_REQUEST",
        `SQL exceeds the ${SQL_LAB_LIMITS.maxSqlBytes}-byte limit.`,
      );
    }
  }

  private rollbackOpenTransaction(): boolean {
    if (!this.database.isTransaction) {
      return false;
    }
    try {
      this.database.exec("ROLLBACK");
      return true;
    } catch {
      return false;
    }
  }
}

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { DEMO_SEED_SQL } from "@/sql-lab/demo-seed";
import { SqliteEngine, SqliteEngineError } from "@/server/sql-lab/sqlite-engine";

const withDatabase = (run: (path: string) => void): void => {
  const directory = mkdtempSync(join(tmpdir(), "web-ide-sql02-"));
  const path = join(directory, "demo.sqlite");
  try {
    run(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("SQL Lab SQLite engine", () => {
  it("rejects a blank database path", () => {
    expect(() => new SqliteEngine({ databasePath: " " })).toThrowError(SqliteEngineError);
  });

  it("executes multiple statements using SQLite sourceSQL boundaries", () => {
    withDatabase((path) => {
      const engine = new SqliteEngine({ databasePath: path });
      engine.execute(DEMO_SEED_SQL);

      const report = engine.execute(
        "/* leading */ SELECT name FROM customers ORDER BY id; SELECT COUNT(*) AS count FROM orders;",
      );

      expect(report.status).toBe("completed");
      expect(report.results).toHaveLength(2);
      expect(report.results[0]).toMatchObject({ kind: "query", returnedRowCount: 4 });
      expect(report.results[1]).toMatchObject({
        kind: "query",
        rows: [[6]],
      });
      engine.close();
    });
  });

  it("preserves duplicate result columns and serializes large values safely", () => {
    withDatabase((path) => {
      const engine = new SqliteEngine({ databasePath: path });
      const report = engine.execute(`
        CREATE TABLE values_test (id INTEGER PRIMARY KEY, blob_value BLOB, text_value TEXT);
        INSERT INTO values_test VALUES (9223372036854775807, X'010203', printf('%.*c', 70000, 'x'));
        SELECT id, id, blob_value, text_value FROM values_test;
      `);
      const query = report.results[2];

      expect(query).toMatchObject({
        kind: "query",
        columns: [{ name: "id" }, { name: "id" }, { name: "blob_value" }, { name: "text_value" }],
        rows: [
          [
            { kind: "integer64", value: "9223372036854775807" },
            { kind: "integer64", value: "9223372036854775807" },
            { kind: "blob", byteLength: 3 },
            { kind: "text", originalByteLength: 70000, truncated: true },
          ],
        ],
      });
      engine.close();
    });
  });

  it("rolls back an explicit transaction after an execution error", () => {
    withDatabase((path) => {
      const engine = new SqliteEngine({ databasePath: path });
      const report = engine.execute(
        "BEGIN; CREATE TABLE transient (id INTEGER); INSERT INTO transient VALUES (1); SELECT * FROM missing_table;",
      );

      expect(report.status).toBe("failed");
      expect(report.transactionRolledBack).toBe(true);
      expect(engine.getSchema().tables.some((table) => table.name === "transient")).toBe(false);
      engine.close();
    });
  });

  it("allows ordinary DDL but does not allow direct schema-table edits", () => {
    withDatabase((path) => {
      const engine = new SqliteEngine({ databasePath: path });
      const ddl = engine.execute(
        "CREATE TABLE ddl_check (id INTEGER); CREATE INDEX ddl_check_index ON ddl_check(id); ALTER TABLE ddl_check ADD COLUMN label TEXT; DROP INDEX ddl_check_index; DROP TABLE ddl_check;",
      );
      const schemaEdit = engine.execute(
        "UPDATE sqlite_schema SET sql = sql WHERE name = 'sqlite_schema'",
      );

      expect(ddl.status).toBe("completed");
      expect(schemaEdit.status).toBe("failed");
      engine.close();
    });
  });

  it.each([
    "ATTACH DATABASE ':memory:' AS other",
    "DETACH DATABASE main",
    "PRAGMA database_list",
    "SELECT * FROM pragma_database_list",
    "SELECT load_extension('anything')",
    "PRAGMA writable_schema = ON",
    "PRAGMA journal_mode = WAL",
    "PRAGMA temp_store_directory = '/tmp'",
    "CREATE VIRTUAL TABLE blocked USING fts5(value)",
    "VACUUM INTO '/tmp/web-ide-sql02-escape.sqlite'",
    "UPDATE sqlite_master SET sql = sql WHERE name = 'sqlite_master'",
  ])("rejects dangerous SQLite operation: %s", (sql) => {
    withDatabase((path) => {
      const engine = new SqliteEngine({ databasePath: path });
      const report = engine.execute(sql);
      expect(report.status).toBe("failed");
      expect(report.results[0]).toMatchObject({ kind: "error" });
      engine.close();
    });
  });

  it("provides schema, explain, health, and file-size protection", () => {
    withDatabase((path) => {
      const engine = new SqliteEngine({ databasePath: path });
      engine.execute(DEMO_SEED_SQL);
      const schema = engine.getSchema();
      const explain = engine.explain("SELECT * FROM orders WHERE customer_id = 1");

      expect(schema.tables.map((table) => table.name)).toEqual([
        "customers",
        "order_items",
        "orders",
        "products",
      ]);
      expect(explain.kind).toBe("query");
      expect(explain.rows.length).toBeGreaterThan(0);
      expect(engine.health()).toBe(true);
      engine.close();
    });

    const directory = mkdtempSync(join(tmpdir(), "web-ide-sql02-large-"));
    const path = join(directory, "large.sqlite");
    try {
      const largeFile = Buffer.alloc(64 * 1024 * 1024 + 1, 0);
      writeFileSync(path, largeFile);
      expect(() => new SqliteEngine({ databasePath: path })).toThrowError(SqliteEngineError);
      expect(statSync(path).size).toBe(64 * 1024 * 1024 + 1);
      expect(readFileSync(path).byteLength).toBe(64 * 1024 * 1024 + 1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

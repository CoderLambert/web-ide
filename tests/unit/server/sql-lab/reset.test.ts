import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { resetSqliteDatabase } from "@/server/sql-lab/reset";
import { SqliteEngine } from "@/server/sql-lab/sqlite-engine";

describe("SQL Lab reset", () => {
  it("does not create files when the database path is unavailable", () => {
    expect(() => resetSqliteDatabase("")).toThrow("database is unavailable");
  });

  it("replaces the active database with the checked demo seed", () => {
    const directory = mkdtempSync(join(tmpdir(), "web-ide-sql07-"));
    const path = join(directory, "demo.sqlite");
    try {
      const schema = resetSqliteDatabase(path);
      const engine = new SqliteEngine({ databasePath: path });
      engine.execute("DELETE FROM customers;");
      engine.close();
      const afterReset = resetSqliteDatabase(path);
      const resetEngine = new SqliteEngine({ databasePath: path });
      const report = resetEngine.execute("SELECT COUNT(*) AS count FROM customers;");

      expect(schema.tables.map((table) => table.name)).toEqual([
        "customers",
        "order_items",
        "orders",
        "products",
      ]);
      expect(afterReset.tables).toHaveLength(4);
      expect(report.status).toBe("completed");
      expect(report.results[0]).toMatchObject({ rows: [[4]] });
      expect(resetEngine.health()).toBe(true);
      resetEngine.close();
      expect(existsSync(path)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores an existing target when replacement health validation fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "web-ide-sql07-rollback-"));
    const path = join(directory, "demo.sqlite");
    mkdirSync(path);
    try {
      expect(() => resetSqliteDatabase(path)).toThrow();
      expect(existsSync(path)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

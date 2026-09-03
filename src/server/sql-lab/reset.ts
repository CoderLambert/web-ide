import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { SqlSchema } from "@/sql-lab/contract";
import { DEMO_SEED_SQL } from "@/sql-lab/demo-seed";
import { SqliteEngine, SqliteEngineError } from "@/server/sql-lab/sqlite-engine";

export function resetSqliteDatabase(databasePath: string): SqlSchema {
  if (databasePath.trim() === "") {
    throw new SqliteEngineError("DATABASE_UNAVAILABLE", "The SQL Lab database is unavailable.");
  }
  const directory = dirname(databasePath);
  mkdirSync(directory, { recursive: true });
  const suffix = randomUUID();
  const temporaryPath = join(directory, `.${basename(databasePath)}.reset-${suffix}.tmp`);
  const backupPath = join(directory, `.${basename(databasePath)}.backup-${suffix}`);
  let activeMoved = false;
  let replacementInstalled = false;
  let schema: SqlSchema | undefined;
  let temporaryEngine: SqliteEngine | undefined;

  try {
    temporaryEngine = new SqliteEngine({ databasePath: temporaryPath });
    const seedReport = temporaryEngine.execute(DEMO_SEED_SQL);
    if (seedReport.status !== "completed" || !temporaryEngine.health()) {
      throw new Error("The SQL Lab demo seed failed its integrity check.");
    }
    schema = temporaryEngine.getSchema();
    temporaryEngine.close();
    temporaryEngine = undefined;

    if (existsSync(databasePath)) {
      renameSync(databasePath, backupPath);
      activeMoved = true;
    }
    renameSync(temporaryPath, databasePath);
    replacementInstalled = true;

    const healthEngine = new SqliteEngine({ databasePath });
    const healthy = healthEngine.health();
    healthEngine.close();
    if (!healthy) {
      throw new Error("The reset database failed its integrity check.");
    }

    if (activeMoved && existsSync(backupPath)) {
      unlinkSync(backupPath);
    }
    return schema;
  } catch (error) {
    temporaryEngine?.close();
    if (replacementInstalled && existsSync(databasePath)) {
      unlinkSync(databasePath);
    }
    if (activeMoved && existsSync(backupPath)) {
      renameSync(backupPath, databasePath);
    }
    throw error;
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
}

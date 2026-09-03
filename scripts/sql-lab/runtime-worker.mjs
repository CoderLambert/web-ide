import { parentPort } from "node:worker_threads";
import { DatabaseSync, constants } from "node:sqlite";

const SAFE_PRAGMAS = new Set(["foreign_keys", "max_page_count", "query_only"]);
const DENIED_ACTIONS = new Set([
  constants.SQLITE_ATTACH,
  constants.SQLITE_DETACH,
  constants.SQLITE_COPY,
  constants.SQLITE_CREATE_VTABLE,
  constants.SQLITE_DROP_VTABLE,
]);

if (parentPort === null) {
  throw new Error("SQL Lab runtime worker requires a parent port.");
}

parentPort.on("message", (message) => {
  let database;
  try {
    if (!isRecord(message) || typeof message.sql !== "string") {
      throw new Error("Runtime worker received an invalid request.");
    }

    database = new DatabaseSync(message.path ?? ":memory:", {
      defensive: true,
      enableForeignKeyConstraints: true,
      allowExtension: false,
      readBigInts: true,
      returnArrays: true,
      timeout: 25,
    });
    database.enableLoadExtension(false);
    database.enableDefensive(true);
    database.setAuthorizer(authorize);
    database.exec("PRAGMA foreign_keys = ON; PRAGMA max_page_count = 64;");

    const results = executeAll(database, message.sql);
    parentPort.postMessage({ ok: true, results });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    database?.close();
  }
});

function executeAll(database, source) {
  const results = [];
  let remaining = source;
  let statementCount = 0;

  while (remaining.trim() !== "") {
    const statement = database.prepare(remaining);
    const consumed = statement.sourceSQL.length;
    if (consumed <= 0) {
      throw new Error("SQLite did not consume the next SQL statement.");
    }

    const columns = statement.columns();
    if (columns.length > 0) {
      const rows = [];
      for (const row of statement.iterate()) {
        rows.push(row);
      }
      results.push({
        kind: "rows",
        columns: columns.map((column) => ({ name: column.name, type: column.type })),
        rows,
      });
    } else {
      results.push({ kind: "changes", changes: statement.run() });
    }

    statementCount += 1;
    if (statementCount > 32) {
      throw new Error("SQL statement count limit exceeded.");
    }
    remaining = remaining.slice(consumed);
  }

  return results;
}

function authorize(actionCode, arg1, arg2) {
  if (DENIED_ACTIONS.has(actionCode)) {
    return constants.SQLITE_DENY;
  }

  if (actionCode === constants.SQLITE_PRAGMA) {
    return SAFE_PRAGMAS.has(String(arg1 ?? "").toLowerCase())
      ? constants.SQLITE_OK
      : constants.SQLITE_DENY;
  }

  if (
    actionCode === constants.SQLITE_FUNCTION &&
    [arg1, arg2].some((value) => String(value ?? "").toLowerCase() === "load_extension")
  ) {
    return constants.SQLITE_DENY;
  }

  return constants.SQLITE_OK;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

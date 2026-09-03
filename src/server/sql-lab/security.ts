import { constants } from "node:sqlite";

const SAFE_PRAGMAS = new Set([
  "table_info",
  "table_xinfo",
  "table_list",
  "index_list",
  "index_info",
  "index_xinfo",
  "foreign_key_list",
  "foreign_key_check",
  "integrity_check",
  "quick_check",
  "data_version",
]);

export type SqliteAuthorizer = (
  actionCode: number,
  arg1: string | null,
  arg2: string | null,
  dbName: string | null,
  triggerOrView: string | null,
) => number;

const isDeniedPragmaFunction = (value: string | null): boolean => {
  const name = value?.toLowerCase() ?? "";
  return name === "load_extension" || name.startsWith("pragma_");
};

export const createSqliteAuthorizer = (): SqliteAuthorizer => (actionCode, arg1, arg2) => {
  if (
    actionCode === constants.SQLITE_ATTACH ||
    actionCode === constants.SQLITE_DETACH ||
    actionCode === constants.SQLITE_COPY ||
    actionCode === constants.SQLITE_CREATE_VTABLE ||
    actionCode === constants.SQLITE_DROP_VTABLE
  ) {
    return constants.SQLITE_DENY;
  }

  if (actionCode === constants.SQLITE_PRAGMA) {
    return SAFE_PRAGMAS.has(arg1?.toLowerCase() ?? "")
      ? constants.SQLITE_OK
      : constants.SQLITE_DENY;
  }

  if (actionCode === constants.SQLITE_FUNCTION && isDeniedPragmaFunction(arg2 ?? arg1)) {
    return constants.SQLITE_DENY;
  }

  return constants.SQLITE_OK;
};

export const isSafePragma = (name: string): boolean => SAFE_PRAGMAS.has(name.toLowerCase());

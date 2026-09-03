import type { SqlLabRequest, SqlLabResponse } from "@/sql-lab/contract";

export const SQL_LAB_DEFAULT_ENDPOINT = "/api/sql-lab";

export const SQL_LAB_OPERATIONS = [
  "execute",
  "schema",
  "explain",
  "reset",
] as const satisfies readonly SqlLabRequest["operation"][];

export type SqlLabOperation = (typeof SQL_LAB_OPERATIONS)[number];

export type SqlLabTransport = (request: SqlLabRequest) => Promise<SqlLabResponse>;

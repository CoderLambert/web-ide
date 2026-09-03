import { describe, expect, it } from "vite-plus/test";

import type {
  SqlLabWorkerRequest,
  SqlLabWorkerResponse,
} from "@/server/sql-lab/execution-protocol";
import { publicSqlLabError, SqlLabService } from "@/server/sql-lab/service";
import { SqliteEngineError } from "@/server/sql-lab/sqlite-engine";

describe("SQL Lab service", () => {
  it("serializes jobs and keeps the database path server-owned", async () => {
    const requests: SqlLabWorkerRequest[] = [];
    let active = 0;
    let maximumActive = 0;
    const host = {
      async run(request: SqlLabWorkerRequest): Promise<SqlLabWorkerResponse> {
        requests.push(request);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          ok: true,
          value: {
            operation: "execute",
            execution: {
              status: "completed",
              results: [],
              executionTimeMs: 1,
              transactionRolledBack: false,
            },
          },
        };
      },
    };
    const service = new SqlLabService({
      databasePath: "/server/controlled/demo.sqlite",
      executionHost: host,
    });

    await Promise.all([
      service.run({ operation: "execute", workspaceId: "one", sql: "SELECT 1" }),
      service.run({ operation: "execute", workspaceId: "one", sql: "SELECT 2" }),
    ]);

    expect(maximumActive).toBe(1);
    expect(requests.map((request) => request.databasePath)).toEqual([
      "/server/controlled/demo.sqlite",
      "/server/controlled/demo.sqlite",
    ]);
  });

  it("sanitizes database errors while preserving safe SQL errors", () => {
    expect(
      publicSqlLabError(
        new SqliteEngineError("DATABASE_UNAVAILABLE", "/srv/private/sql-lab.sqlite: EACCES"),
      ),
    ).toEqual({
      code: "DATABASE_UNAVAILABLE",
      message: "The SQL Lab database is unavailable.",
    });
    expect(
      publicSqlLabError(new SqliteEngineError("SQL_ERROR", 'near "FROM": syntax error')),
    ).toEqual({
      code: "SQL_ERROR",
      message: 'near "FROM": syntax error',
    });
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { SqlLabWorkerRequest } from "@/server/sql-lab/execution-protocol";
import { SqlLabChildProcessExecutionHost } from "@/server/sql-lab/execution-host";

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "web-ide-sql-lab-execution-host-"));
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("SqlLabChildProcessExecutionHost", () => {
  it("runs a request in a child process", async () => {
    const response = await run({
      operation: "execute",
      databasePath: join(fixtureRoot, "database.sqlite"),
      sql: "SELECT 43 AS answer;",
    });

    expect(response).toMatchObject({
      ok: true,
      value: {
        operation: "execute",
        execution: { status: "completed", results: [{ kind: "query", rows: [[43]] }] },
      },
    });
  });

  it("kills a timed-out child and can run the next request", async () => {
    const timeout = await run({
      operation: "execute",
      databasePath: join(fixtureRoot, "database.sqlite"),
      sql: `WITH RECURSIVE counter(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM counter WHERE value < 1000000000
      ) SELECT sum(value) FROM counter;`,
    });

    expect(timeout).toMatchObject({
      ok: true,
      value: { operation: "execute", execution: { status: "timeout" } },
    });

    const afterTimeout = await run({
      operation: "execute",
      databasePath: join(fixtureRoot, "database.sqlite"),
      sql: "SELECT 43 AS answer;",
    });
    expect(afterTimeout).toMatchObject({
      ok: true,
      value: { execution: { results: [{ rows: [[43]] }] } },
    });
  }, 15_000);
});

function run(request: SqlLabWorkerRequest) {
  return new SqlLabChildProcessExecutionHost().run(request);
}

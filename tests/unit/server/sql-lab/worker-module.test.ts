import { describe, expect, it } from "vite-plus/test";

describe("SQL Lab worker module", () => {
  it("can be imported by the main thread without executing worker work", async () => {
    const workerModule = await import("@/server/sql-lab/sqlite-execution.worker");

    expect(workerModule.SQL_LAB_WORKER_ENTRY_URL).toContain("sqlite-execution.worker");
  });
});

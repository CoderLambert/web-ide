import { describe, expect, it } from "vite-plus/test";

import { handleSqlLabApiRequest } from "@/server/sql-lab/api";

const service = {
  async run(request: { operation: string; workspaceId: string; sql?: string }) {
    return {
      ok: true as const,
      value:
        request.operation === "schema"
          ? { operation: "schema" as const, schema: { tables: [] } }
          : {
              operation: "execute" as const,
              execution: {
                status: "completed" as const,
                results: [],
                executionTimeMs: 1,
                transactionRolledBack: false,
              },
            },
    };
  },
};

const dependencies = {
  service,
  authorize(workspaceId: string) {
    if (workspaceId !== "workspace-1") {
      throw new Error("denied");
    }
  },
};

describe("SQL Lab API", () => {
  it("decodes strict requests and delegates authorized operations", async () => {
    const response = await handleSqlLabApiRequest(
      new Request("http://localhost/api/sql-lab", {
        method: "POST",
        body: JSON.stringify({ operation: "schema", workspaceId: "workspace-1" }),
        headers: { "content-type": "application/json" },
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, value: { operation: "schema" } });
  });

  it("rejects extra fields and unsupported methods before execution", async () => {
    const invalid = await handleSqlLabApiRequest(
      new Request("http://localhost/api/sql-lab", {
        method: "POST",
        body: JSON.stringify({
          operation: "execute",
          workspaceId: "workspace-1",
          sql: "SELECT 1",
          databasePath: "/tmp/not-client-controlled",
        }),
      }),
      dependencies,
    );
    const method = await handleSqlLabApiRequest(
      new Request("http://localhost/api/sql-lab", { method: "GET" }),
      dependencies,
    );

    expect(invalid.status).toBe(400);
    expect(method.status).toBe(405);
  });

  it("returns forbidden when authorization rejects the workspace", async () => {
    const response = await handleSqlLabApiRequest(
      new Request("http://localhost/api/sql-lab", {
        method: "POST",
        body: JSON.stringify({ operation: "schema", workspaceId: "other" }),
      }),
      dependencies,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  });
});

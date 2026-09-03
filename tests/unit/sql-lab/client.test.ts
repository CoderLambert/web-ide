import { describe, expect, it } from "vite-plus/test";

import { SqlLabClient, SqlLabClientError } from "@/features/sql-lab/client/sql-lab-client";

describe("SQL Lab client", () => {
  it("sends only the public request DTO and same-origin credentials", async () => {
    let received: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const client = new SqlLabClient({
      workspaceId: "workspace-1",
      fetch: async (input, init) => {
        received = { input, init };
        return Response.json({
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
        });
      },
    });

    const response = await client.execute("SELECT 1");
    const bodyText = received?.init?.body;
    expect(typeof bodyText).toBe("string");
    const body = JSON.parse(bodyText as string) as Record<string, unknown>;

    expect(response.ok).toBe(true);
    expect(received?.input).toBe("/api/sql-lab");
    expect(received?.init?.credentials).toBe("same-origin");
    expect(body).toEqual({ operation: "execute", workspaceId: "workspace-1", sql: "SELECT 1" });
  });

  it("rejects malformed response envelopes", async () => {
    const client = new SqlLabClient({
      workspaceId: "workspace-1",
      fetch: async () => Response.json({ ok: true, value: { operation: "unknown" } }),
    });

    await expect(client.schema()).rejects.toBeInstanceOf(SqlLabClientError);
  });
});

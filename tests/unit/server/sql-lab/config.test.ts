import { describe, expect, it } from "vite-plus/test";

import { createSqlLabApiHandler } from "@/server/sql-lab/config.server";

async function requestFor(handler: (request: Request) => Promise<Response>): Promise<Response> {
  return handler(
    new Request("http://localhost/api/sql-lab", {
      method: "POST",
      body: JSON.stringify({ operation: "schema", workspaceId: "workspace-1" }),
      headers: {
        "content-type": "application/json",
        cookie: "web_ide_workspace_token=token-1",
      },
    }),
  );
}

describe("SQL Lab server configuration", () => {
  it("fails closed when the database path is missing", async () => {
    const response = await requestFor(
      createSqlLabApiHandler({ workspaceId: "workspace-1", token: "token-1" }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "DATABASE_UNAVAILABLE" },
    });
  });

  it("fails closed when the workspace root is missing", async () => {
    const response = await requestFor(
      createSqlLabApiHandler({
        workspaceId: "workspace-1",
        token: "token-1",
        databasePath: "/tmp/sql-lab.sqlite",
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "DATABASE_UNAVAILABLE" },
    });
  });
});

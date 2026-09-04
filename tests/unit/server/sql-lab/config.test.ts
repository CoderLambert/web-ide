import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vite-plus/test";

import { createSqlLabApiHandler } from "@/server/sql-lab/config.server";
import { resolveWorkspaceSessionCookieName } from "@/server/workspace/session-cookie";

async function requestFor(handler: (request: Request) => Promise<Response>): Promise<Response> {
  return handler(
    new Request("http://localhost/api/sql-lab", {
      method: "POST",
      body: JSON.stringify({ operation: "schema", workspaceId: "workspace-1" }),
      headers: {
        "content-type": "application/json",
        cookie: "web_ide_workspace_token=token-1",
        host: "localhost",
      },
    }),
  );
}

describe("SQL Lab server configuration", () => {
  it.each([
    { name: "undefined database path", databasePath: undefined, workspaceRoot: "/tmp/workspace" },
    { name: "empty database path", databasePath: "", workspaceRoot: "/tmp/workspace" },
    { name: "blank database path", databasePath: "   ", workspaceRoot: "/tmp/workspace" },
    {
      name: "undefined workspace root",
      databasePath: "/tmp/sql-lab.sqlite",
      workspaceRoot: undefined,
    },
    { name: "empty workspace root", databasePath: "/tmp/sql-lab.sqlite", workspaceRoot: "" },
    { name: "blank workspace root", databasePath: "/tmp/sql-lab.sqlite", workspaceRoot: "   " },
  ])("fails closed for $name", async ({ databasePath, workspaceRoot }) => {
    const response = await requestFor(
      createSqlLabApiHandler({
        workspaceId: "workspace-1",
        token: "token-1",
        databasePath,
        workspaceRoot,
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "DATABASE_UNAVAILABLE" },
    });
  });

  it("accepts normal paths during handler configuration", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "web-ide-sql-config-workspace-"));
    const databaseRoot = await mkdtemp(join(tmpdir(), "web-ide-sql-config-database-"));
    try {
      const handler = createSqlLabApiHandler({
        workspaceId: "workspace-1",
        token: "token-1",
        databasePath: join(databaseRoot, "sql-lab.sqlite"),
        workspaceRoot,
      });
      const response = await handler(
        new Request("http://localhost/api/sql-lab", { method: "GET" }),
      );

      expect(response.status).toBe(405);
    } finally {
      await Promise.all([
        rm(workspaceRoot, { recursive: true, force: true }),
        rm(databaseRoot, { recursive: true, force: true }),
      ]);
    }
  });

  it("uses the local host namespace for SQL Lab authorization", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "web-ide-sql-local-config-workspace-"));
    const databaseRoot = await mkdtemp(join(tmpdir(), "web-ide-sql-local-config-database-"));
    try {
      const handler = createSqlLabApiHandler({
        workspaceId: "workspace-1",
        token: "token-1",
        enabled: "1",
        databasePath: join(databaseRoot, "sql-lab.sqlite"),
        workspaceRoot,
      });
      const cookieName = resolveWorkspaceSessionCookieName({
        enabled: "1",
        host: "localhost:3000",
      });
      const response = await handler(
        new Request("http://localhost:3000/api/sql-lab", {
          method: "POST",
          body: JSON.stringify({ operation: "schema", workspaceId: "workspace-1" }),
          headers: {
            "content-type": "application/json",
            cookie: `${cookieName}=token-1`,
            host: "localhost:3000",
          },
        }),
      );

      expect(response.status).toBe(200);
    } finally {
      await Promise.all([
        rm(workspaceRoot, { recursive: true, force: true }),
        rm(databaseRoot, { recursive: true, force: true }),
      ]);
    }
  });
});

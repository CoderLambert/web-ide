import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { handleWorkspaceApiRequestWithConfiguration } from "../../../src/server/workspace/api.server";
import { resolveWorkspaceSessionCookieName } from "../../../src/server/workspace/session-cookie";

let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "web-ide-workspace-config-"));
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("Workspace server configuration", () => {
  it.each([
    {
      name: "undefined workspace id",
      workspaceId: undefined,
      token: "token-1",
      root: workspaceRoot,
    },
    { name: "empty workspace id", workspaceId: "", token: "token-1", root: workspaceRoot },
    { name: "blank workspace id", workspaceId: "   ", token: "token-1", root: workspaceRoot },
    { name: "undefined token", workspaceId: "workspace-1", token: undefined, root: workspaceRoot },
    { name: "empty token", workspaceId: "workspace-1", token: "", root: workspaceRoot },
    { name: "blank token", workspaceId: "workspace-1", token: "   ", root: workspaceRoot },
  ])("fails closed for $name", async ({ workspaceId, token, root }) => {
    const response = await requestFor({ workspaceId, token, root });

    expect(response.status).toBe(403);
  });

  it.each([undefined, "", "   "])("returns unavailable for workspace root %j", async (root) => {
    const response = await requestFor({
      workspaceId: "workspace-1",
      token: "token-1",
      root,
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "IO_ERROR" },
    });
  });

  it("accepts a normal configuration", async () => {
    const response = await requestFor({
      workspaceId: "workspace-1",
      token: "token-1",
      root: workspaceRoot,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: [] });
  });

  it("uses the local host namespace for workspace authorization", async () => {
    const cookieName = resolveWorkspaceSessionCookieName({
      enabled: "1",
      host: "localhost:3000",
    });
    const response = await requestFor({
      workspaceId: "workspace-1",
      token: "token-1",
      root: workspaceRoot,
      enabled: "1",
      cookie: `${cookieName}=token-1`,
      host: "localhost:3000",
    });

    expect(response.status).toBe(200);
  });
});

async function requestFor(configuration: {
  workspaceId?: string;
  token?: string;
  root?: string;
  enabled?: string;
  cookie?: string;
  host?: string;
}): Promise<Response> {
  return handleWorkspaceApiRequestWithConfiguration(
    new Request("http://localhost/api/workspace", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: configuration.cookie ?? "web_ide_workspace_token=token-1",
        host: configuration.host ?? "localhost",
      },
      body: JSON.stringify({ workspaceId: "workspace-1", operation: "list", path: "" }),
    }),
    configuration,
  );
}

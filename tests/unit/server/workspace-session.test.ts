import { describe, expect, it } from "vite-plus/test";

import {
  handleWorkspaceSessionRequestWithConfiguration,
  type WorkspaceSessionConfiguration,
} from "../../../src/server/workspace/session.server";

const configured: WorkspaceSessionConfiguration = {
  token: "server-secret",
  workspaceId: "workspace-1",
};

describe("Workspace session route", () => {
  it("returns 204 for a valid existing cookie without setting a cookie", async () => {
    const response = handleWorkspaceSessionRequestWithConfiguration(
      new Request("https://example.test/api/workspace/session", {
        method: "POST",
        headers: { cookie: "web_ide_workspace_token=server-secret" },
      }),
      configured,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-web-ide-workspace-id")).toBe("workspace-1");
    expect(await response.text()).toBe("");
  });

  it.each([
    { name: "cookie is absent", cookie: undefined },
    { name: "cookie is incorrect", cookie: "web_ide_workspace_token=wrong-secret" },
  ])("returns forbidden when $name", async ({ cookie }) => {
    const headers = cookie === undefined ? undefined : { cookie };
    const response = handleWorkspaceSessionRequestWithConfiguration(
      new Request("http://localhost/api/workspace/session", { method: "POST", headers }),
      configured,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-web-ide-workspace-id")).toBeNull();
    expect(await response.text()).not.toContain("server-secret");
  });

  it.each([
    { name: "workspace id is undefined", workspaceId: undefined, token: "server-secret" },
    { name: "workspace id is empty", workspaceId: "", token: "server-secret" },
    { name: "workspace id is blank", workspaceId: "   ", token: "server-secret" },
    { name: "token is undefined", workspaceId: "workspace-1", token: undefined },
    { name: "token is empty", workspaceId: "workspace-1", token: "" },
    { name: "token is blank", workspaceId: "workspace-1", token: "   " },
  ])("fails closed when $name", async ({ workspaceId, token }) => {
    const response = handleWorkspaceSessionRequestWithConfiguration(
      new Request("http://localhost/api/workspace/session", {
        method: "POST",
        headers: { cookie: "web_ide_workspace_token=server-secret" },
      }),
      { workspaceId, token },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-web-ide-workspace-id")).toBeNull();
  });

  it("only allows POST", () => {
    const response = handleWorkspaceSessionRequestWithConfiguration(
      new Request("http://localhost/api/workspace/session", { method: "GET" }),
      configured,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

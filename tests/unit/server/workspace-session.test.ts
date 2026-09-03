import { describe, expect, it } from "vite-plus/test";

import {
  handleWorkspaceSessionRequestWithConfiguration,
  type WorkspaceSessionConfiguration,
} from "../../../src/server/workspace/session.server";

const enabledConfiguration: WorkspaceSessionConfiguration = {
  localSessionBootstrap: "1",
  token: "server-secret",
  workspaceId: "workspace-1",
};

describe("Workspace local development session bootstrap", () => {
  it("sets an HttpOnly strict same-origin cookie without a response body", async () => {
    const response = handleWorkspaceSessionRequestWithConfiguration(
      new Request("http://localhost:3000/api/workspace/session", { method: "POST" }),
      enabledConfiguration,
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("set-cookie")).toBe(
      "web_ide_workspace_token=server-secret; Path=/; HttpOnly; SameSite=Strict",
    );
  });

  it("adds Secure only for HTTPS requests", () => {
    const response = handleWorkspaceSessionRequestWithConfiguration(
      new Request("https://127.0.0.1/api/workspace/session", { method: "POST" }),
      enabledConfiguration,
    );

    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it.each([
    {
      name: "bootstrap flag is disabled",
      configuration: { ...enabledConfiguration, localSessionBootstrap: "0" },
      url: "http://localhost/api/workspace/session",
    },
    {
      name: "workspace id is missing",
      configuration: { ...enabledConfiguration, workspaceId: undefined },
      url: "http://localhost/api/workspace/session",
    },
    {
      name: "token is missing",
      configuration: { ...enabledConfiguration, token: undefined },
      url: "http://localhost/api/workspace/session",
    },
    {
      name: "host is not local",
      configuration: enabledConfiguration,
      url: "http://example.test/api/workspace/session",
    },
  ])("rejects when $name", async ({ configuration, url }) => {
    const response = handleWorkspaceSessionRequestWithConfiguration(
      new Request(url, { method: "POST" }),
      configuration,
    );

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain('"FORBIDDEN"');
    expect(body).not.toContain("server-secret");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("accepts the IPv6 loopback host", () => {
    const response = handleWorkspaceSessionRequestWithConfiguration(
      new Request("http://[::1]:3000/api/workspace/session", { method: "POST" }),
      enabledConfiguration,
    );

    expect(response.status).toBe(204);
  });
});

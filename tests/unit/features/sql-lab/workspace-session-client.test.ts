import { describe, expect, it } from "vite-plus/test";

import { bootstrapWorkspaceSession } from "@/features/sql-lab/client/workspace-session-client";

describe("Workspace session client", () => {
  it("uses a same-origin POST and returns the server-owned workspace ID", async () => {
    let received: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    await expect(
      bootstrapWorkspaceSession({
        fetch: async (input, init) => {
          received = { input, init };
          return new Response(null, {
            status: 204,
            headers: { "X-Web-Ide-Workspace-Id": "workspace-123" },
          });
        },
      }),
    ).resolves.toBe("workspace-123");

    expect(received?.input).toBe("/api/workspace/session");
    expect(received?.init).toMatchObject({ credentials: "same-origin", method: "POST" });
  });

  it("normalizes bootstrap failures without exposing a response body", async () => {
    await expect(
      bootstrapWorkspaceSession({
        fetch: async () => Response.json({ error: "server-secret" }, { status: 403 }),
      }),
    ).rejects.toThrow("Workspace session bootstrap failed.");
  });

  it.each([
    { name: "forbidden response", response: Response.json({}, { status: 403 }) },
    { name: "missing workspace ID", response: new Response(null, { status: 204 }) },
    {
      name: "blank workspace ID",
      response: new Response(null, {
        status: 204,
        headers: { "X-Web-Ide-Workspace-Id": "   " },
      }),
    },
  ])("rejects a $name", async ({ response }) => {
    await expect(bootstrapWorkspaceSession({ fetch: async () => response })).rejects.toThrow(
      "Workspace session bootstrap failed.",
    );
  });
});

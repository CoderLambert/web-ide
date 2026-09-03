import { describe, expect, it } from "vite-plus/test";

import { bootstrapWorkspaceSession } from "@/features/sql-lab/client/workspace-session-client";

describe("Workspace session client", () => {
  it("uses a same-origin POST and accepts only an empty 204 response", async () => {
    let received: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    await bootstrapWorkspaceSession({
      fetch: async (input, init) => {
        received = { input, init };
        return new Response(null, { status: 204 });
      },
    });

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
});

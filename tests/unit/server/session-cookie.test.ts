import { describe, expect, it } from "vite-plus/test";

import {
  resolveWorkspaceSessionCookieName,
  WORKSPACE_SESSION_COOKIE_NAME,
} from "../../../src/server/workspace/session-cookie";

describe("workspace session cookie names", () => {
  it("separates local hosts by normalized host and port", () => {
    const port3000 = resolveWorkspaceSessionCookieName({
      enabled: "1",
      host: "localhost:3000",
    });
    const port4173 = resolveWorkspaceSessionCookieName({
      enabled: "1",
      host: "localhost:4173",
    });

    expect(port3000).toMatch(/^web_ide_workspace_token_[a-f0-9]{16}$/);
    expect(port3000).not.toBe(port4173);
    expect(resolveWorkspaceSessionCookieName({ enabled: "1", host: "LOCALHOST:3000" })).toBe(
      port3000,
    );
  });

  it("keeps the production cookie name independent of the host", () => {
    expect(resolveWorkspaceSessionCookieName({ enabled: "0", host: "localhost:3000" })).toBe(
      WORKSPACE_SESSION_COOKIE_NAME,
    );
    expect(resolveWorkspaceSessionCookieName({ host: "localhost:3000" })).toBe(
      WORKSPACE_SESSION_COOKIE_NAME,
    );
  });
});

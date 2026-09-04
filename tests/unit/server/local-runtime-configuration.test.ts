import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { resolveLocalRuntimeConfiguration } from "@/server/workspace/local-runtime-configuration";

describe("local runtime configuration", () => {
  it("generates local defaults from the canonical workspace root", () => {
    const workspaceRoot = realpathSync(process.cwd());
    const configuration = resolveLocalRuntimeConfiguration({}, workspaceRoot);

    expect(configuration.enabled).toBe("1");
    expect(configuration.workspaceRoot).toBe(workspaceRoot);
    expect(configuration.workspaceId).toMatch(/^local-[a-f0-9]{16}$/);
    expect(configuration.token).toMatch(/^[a-f0-9]{64}$/);
    expect(configuration.databasePath.startsWith(tmpdir())).toBe(true);
    expect(isAbsolute(relative(workspaceRoot, configuration.databasePath))).toBe(false);
    expect(relative(workspaceRoot, configuration.databasePath)).toMatch(/^\.\./);
  });

  it.each([
    ["workspace root", "WEB_IDE_WORKSPACE_ROOT", ""],
    ["workspace root blank", "WEB_IDE_WORKSPACE_ROOT", "   "],
    ["workspace ID", "WEB_IDE_WORKSPACE_ID", ""],
    ["token", "WEB_IDE_WORKSPACE_TOKEN", "   "],
    ["database path", "WEB_IDE_SQL_LAB_DATABASE_PATH", ""],
    ["bootstrap", "WEB_IDE_LOCAL_SESSION_BOOTSTRAP", "   "],
  ])("preserves a configured blank %s value", (_name, key, value) => {
    const currentWorkingDirectory =
      key === "WEB_IDE_WORKSPACE_ROOT" ? "/canonical/root" : process.cwd();
    const configuration = resolveLocalRuntimeConfiguration(
      { [key]: value },
      currentWorkingDirectory,
    );

    const propertyByEnvironmentName: Record<string, keyof typeof configuration> = {
      WEB_IDE_WORKSPACE_ROOT: "workspaceRoot",
      WEB_IDE_WORKSPACE_ID: "workspaceId",
      WEB_IDE_WORKSPACE_TOKEN: "token",
      WEB_IDE_SQL_LAB_DATABASE_PATH: "databasePath",
      WEB_IDE_LOCAL_SESSION_BOOTSTRAP: "enabled",
    };
    expect(configuration[propertyByEnvironmentName[key]]).toBe(value);
  });

  it("preserves normal configured values", () => {
    const configuration = resolveLocalRuntimeConfiguration({
      WEB_IDE_LOCAL_SESSION_BOOTSTRAP: "0",
      WEB_IDE_WORKSPACE_ID: "workspace-123",
      WEB_IDE_WORKSPACE_ROOT: "/workspace/root",
      WEB_IDE_WORKSPACE_TOKEN: " token with spaces ",
      WEB_IDE_SQL_LAB_DATABASE_PATH: "/tmp/sql-lab.sqlite",
    });

    expect(configuration).toEqual({
      enabled: "0",
      workspaceId: "workspace-123",
      workspaceRoot: "/workspace/root",
      token: " token with spaces ",
      databasePath: "/tmp/sql-lab.sqlite",
    });
  });
});

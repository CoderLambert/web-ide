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
    ["bootstrap value", "WEB_IDE_LOCAL_SESSION_BOOTSTRAP", "invalid"],
  ])("rejects an invalid configured %s value", (_name, key, value) => {
    expect(() =>
      resolveLocalRuntimeConfiguration(
        { [key]: value },
        key === "WEB_IDE_WORKSPACE_ROOT" ? "/path-that-must-not-be-read" : undefined,
      ),
    ).toThrow("Invalid local runtime configuration");
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

  it("uses the user-local fallback when the temporary directory is the workspace", () => {
    const workspaceRoot = realpathSync(tmpdir());
    const configuration = resolveLocalRuntimeConfiguration({}, workspaceRoot, {
      temporaryDirectory: workspaceRoot,
      homeDirectory: "/home/web-ide-test",
    });

    expect(configuration.databasePath).toEqual(
      expect.stringContaining("/home/web-ide-test/.cache/web-ide/"),
    );
    expect(relative(workspaceRoot, configuration.databasePath)).toMatch(/^\.\./);
  });

  it("fails explicitly when both default candidates are in the workspace", () => {
    const workspaceRoot = realpathSync(tmpdir());

    expect(() =>
      resolveLocalRuntimeConfiguration({}, workspaceRoot, {
        temporaryDirectory: workspaceRoot,
        homeDirectory: workspaceRoot,
      }),
    ).toThrow("Unable to choose a SQL Lab database path outside the workspace.");
  });

  it("preserves an explicit database path outside the workspace", () => {
    const workspaceRoot = realpathSync(tmpdir());
    const databasePath = "/home/web-ide-test/sql-lab.sqlite";

    const configuration = resolveLocalRuntimeConfiguration({
      WEB_IDE_WORKSPACE_ROOT: workspaceRoot,
      WEB_IDE_SQL_LAB_DATABASE_PATH: databasePath,
    });

    expect(configuration.databasePath).toBe(databasePath);
  });

  it("rejects an explicit database path inside the workspace", () => {
    const workspaceRoot = realpathSync(tmpdir());

    expect(() =>
      resolveLocalRuntimeConfiguration({
        WEB_IDE_WORKSPACE_ROOT: workspaceRoot,
        WEB_IDE_SQL_LAB_DATABASE_PATH: `${workspaceRoot}/sql-lab.sqlite`,
      }),
    ).toThrow("SQL Lab database must be outside the workspace.");
  });
});

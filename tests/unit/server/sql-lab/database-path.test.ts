import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { assertDatabasePathOutsideWorkspace } from "@/server/sql-lab/database-path";

describe("SQL Lab database path", () => {
  it("rejects a database inside the workspace and allows a sibling path", () => {
    const root = mkdtempSync(join(tmpdir(), "web-ide-sql-path-"));
    const workspace = join(root, "workspace");
    const database = join(root, "database", "demo.sqlite");
    try {
      expect(() =>
        assertDatabasePathOutsideWorkspace(join(workspace, "demo.sqlite"), workspace),
      ).toThrow("outside the workspace");
      expect(() => assertDatabasePathOutsideWorkspace(database, workspace)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves symlink ancestors before checking missing database descendants", () => {
    const root = mkdtempSync(join(tmpdir(), "web-ide-sql-path-symlink-"));
    const workspace = join(root, "workspace");
    const linkedWorkspace = join(root, "linked-workspace");
    mkdirSync(workspace, { recursive: true });
    symlinkSync(workspace, linkedWorkspace, "dir");
    try {
      expect(() =>
        assertDatabasePathOutsideWorkspace(
          join(linkedWorkspace, "missing", "demo.sqlite"),
          workspace,
        ),
      ).toThrow("outside the workspace");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects blank paths", () => {
    expect(() => assertDatabasePathOutsideWorkspace("", "/tmp/workspace")).toThrow(
      "paths are required",
    );
  });
});

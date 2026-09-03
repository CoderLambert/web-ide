import { mkdtempSync, rmSync } from "node:fs";
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
});

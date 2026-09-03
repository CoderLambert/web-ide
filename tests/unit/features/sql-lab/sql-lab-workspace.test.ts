import { describe, expect, it } from "vite-plus/test";

import { listSqlFiles, nextSqlFileName } from "@/features/sql-lab/editor/sql-lab-workspace";

describe("SQL Lab workspace files", () => {
  it("recursively lists only SQL files in stable order", async () => {
    const fileSystem = {
      async list(path: string) {
        if (path === "") {
          return [
            { path: "z.txt", kind: "file" as const },
            { path: "queries", kind: "directory" as const },
            { path: "top.SQL", kind: "file" as const },
          ];
        }
        return [
          { path: "queries/b.sql", kind: "file" as const },
          { path: "queries/a.sql", kind: "file" as const },
        ];
      },
    };

    await expect(listSqlFiles(fileSystem)).resolves.toEqual([
      "queries/a.sql",
      "queries/b.sql",
      "top.SQL",
    ]);
  });

  it("chooses a non-conflicting new SQL file name", () => {
    expect(nextSqlFileName([])).toBe("query.sql");
    expect(nextSqlFileName(["query.sql", "query-1.sql", "query-3.sql"])).toBe("query-2.sql");
  });
});

import { describe, expect, it } from "vite-plus/test";

import { listSqlDirectory, nextSqlFileName } from "@/features/sql-lab/editor/sql-lab-workspace";

describe("SQL Lab workspace files", () => {
  it("lists one directory level and never recursively scans children", async () => {
    const listCalls: string[] = [];
    const fileSystem = {
      async list(path: string) {
        listCalls.push(path);
        if (path === "") {
          return [
            { path: "z.txt", kind: "file" as const },
            { path: "src", kind: "directory" as const },
            { path: "node_modules", kind: "directory" as const },
            { path: "docs", kind: "directory" as const },
            { path: "top.SQL", kind: "file" as const },
          ];
        }
        return [
          { path: "src/nested", kind: "directory" as const },
          { path: "src/query.sql", kind: "file" as const },
        ];
      },
    };

    await expect(listSqlDirectory(fileSystem, "")).resolves.toEqual([
      { path: "docs", kind: "directory" },
      { path: "node_modules", kind: "directory" },
      { path: "src", kind: "directory" },
      { path: "top.SQL", kind: "file" },
    ]);
    expect(listCalls).toEqual([""]);

    await expect(listSqlDirectory(fileSystem, "src")).resolves.toEqual([
      { path: "src/nested", kind: "directory" },
      { path: "src/query.sql", kind: "file" },
    ]);
    expect(listCalls).toEqual(["", "src"]);
  });

  it("chooses a non-conflicting new SQL file name", () => {
    expect(nextSqlFileName([])).toBe("query.sql");
    expect(nextSqlFileName(["src/query.sql"])).toBe("query-1.sql");
    expect(nextSqlFileName(["query.sql", "query-1.sql", "query-3.sql"])).toBe("query-2.sql");
  });
});

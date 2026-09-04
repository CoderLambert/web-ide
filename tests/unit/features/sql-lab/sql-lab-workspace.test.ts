import { describe, expect, it } from "vite-plus/test";

import {
  listSqlDirectory,
  nextSqlFileName,
  scheduleDirectoryLoad,
} from "@/features/sql-lab/editor/sql-lab-workspace";

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

  it("reuses an in-flight directory load", async () => {
    const loads = new Map<string, Promise<string[]>>();
    let resolveList!: (entries: string[]) => void;
    let listCalls = 0;
    const pending = new Promise<string[]>((resolve) => {
      resolveList = resolve;
    });

    const first = scheduleDirectoryLoad(loads, "src", false, async () => {
      listCalls += 1;
      return pending;
    });
    const second = scheduleDirectoryLoad(loads, "src", false, async () => {
      listCalls += 1;
      return ["unexpected"];
    });

    expect(second).toBe(first);
    expect(listCalls).toBe(1);
    resolveList(["src/query.sql"]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      ["src/query.sql"],
      ["src/query.sql"],
    ]);
    expect(loads.has("src")).toBe(false);
  });

  it("orders a forced refresh after an in-flight directory load", async () => {
    const loads = new Map<string, Promise<string[]>>();
    let resolveInitial!: (entries: string[]) => void;
    let listCalls = 0;
    const initial = new Promise<string[]>((resolve) => {
      resolveInitial = resolve;
    });

    const first = scheduleDirectoryLoad(loads, "", false, async () => {
      listCalls += 1;
      return initial;
    });
    const forced = scheduleDirectoryLoad(loads, "", true, async () => {
      listCalls += 1;
      return ["query-1.sql"];
    });

    expect(listCalls).toBe(1);
    resolveInitial(["query.sql"]);
    await expect(first).resolves.toEqual(["query.sql"]);
    await expect(forced).resolves.toEqual(["query-1.sql"]);
    expect(listCalls).toBe(2);
    expect(loads.has("")).toBe(false);
  });

  it("allows a failed directory load to be retried", async () => {
    const loads = new Map<string, Promise<string[]>>();
    let shouldFail = true;
    let listCalls = 0;

    const first = scheduleDirectoryLoad(loads, "src", false, async () => {
      listCalls += 1;
      if (shouldFail) {
        throw new Error("temporary failure");
      }
      return ["src/query.sql"];
    });

    await expect(first).rejects.toThrow("temporary failure");
    expect(loads.has("src")).toBe(false);

    shouldFail = false;
    await expect(
      scheduleDirectoryLoad(loads, "src", false, async () => {
        listCalls += 1;
        return ["src/query.sql"];
      }),
    ).resolves.toEqual(["src/query.sql"]);
    expect(listCalls).toBe(2);
  });
});

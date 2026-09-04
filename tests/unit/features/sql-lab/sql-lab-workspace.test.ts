import { describe, expect, it } from "vite-plus/test";

import {
  createDirectoryLoader,
  listSqlDirectory,
  nextSqlFileName,
  projectSqlDirectoryEntries,
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
    let resolveList!: (entries: string[]) => void;
    let listCalls = 0;
    const pending = new Promise<string[]>((resolve) => {
      resolveList = resolve;
    });

    const loader = createDirectoryLoader<string[]>(async () => {
      listCalls += 1;
      return pending;
    });
    const first = loader.load("src");
    const second = loader.load("src");

    expect(second).toBe(first);
    expect(listCalls).toBe(1);
    resolveList(["src/query.sql"]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      ["src/query.sql"],
      ["src/query.sql"],
    ]);
    expect(loader.getCached("src")).toEqual(["src/query.sql"]);
  });

  it("orders a forced refresh after an in-flight directory load", async () => {
    let resolveInitial!: (entries: string[]) => void;
    let listCalls = 0;
    const initial = new Promise<string[]>((resolve) => {
      resolveInitial = resolve;
    });

    const loader = createDirectoryLoader<string[]>(async () => {
      listCalls += 1;
      if (listCalls === 1) {
        return initial;
      }
      return ["query-1.sql"];
    });
    const first = loader.load("");
    const forced = loader.load("", true);

    expect(listCalls).toBe(1);
    resolveInitial(["query.sql"]);
    await expect(first).resolves.toEqual(["query.sql"]);
    await expect(forced).resolves.toEqual(["query-1.sql"]);
    expect(listCalls).toBe(2);
    expect(loader.getCached("")).toEqual(["query-1.sql"]);
  });

  it("allows a failed directory load to be retried", async () => {
    let shouldFail = true;
    let listCalls = 0;

    const loader = createDirectoryLoader<string[]>(async () => {
      listCalls += 1;
      if (shouldFail) {
        throw new Error("temporary failure");
      }
      return ["src/query.sql"];
    });

    await expect(loader.load("src")).rejects.toThrow("temporary failure");
    expect(loader.getCached("src")).toBeUndefined();

    shouldFail = false;
    await expect(loader.load("src")).resolves.toEqual(["src/query.sql"]);
    expect(listCalls).toBe(2);
  });

  it("keeps a completed cache for normal loads", async () => {
    let listCalls = 0;
    const loader = createDirectoryLoader(async () => {
      listCalls += 1;
      return ["src/query.sql"];
    });

    await loader.load("src");
    await loader.load("src");

    expect(listCalls).toBe(1);
  });

  it("does not return stale cache while a forced refresh is in flight", async () => {
    let resolveRefresh!: (entries: string[]) => void;
    let listCalls = 0;
    const loader = createDirectoryLoader<string[]>(async () => {
      listCalls += 1;
      if (listCalls === 1) {
        return ["old.sql"];
      }
      return new Promise<string[]>((resolve) => {
        resolveRefresh = resolve;
      });
    });

    await loader.load("");
    const forced = loader.load("", true);
    const normal = loader.load("");

    expect(normal).toBe(forced);
    expect(loader.getCached("")).toEqual(["old.sql"]);
    resolveRefresh(["fresh.sql"]);
    await expect(normal).resolves.toEqual(["fresh.sql"]);
    expect(loader.getCached("")).toEqual(["fresh.sql"]);
  });

  it("projects SQL files and hides generated directories by default", () => {
    const entries = [
      { path: "src", kind: "directory" as const },
      { path: ".hidden", kind: "directory" as const },
      { path: "node_modules", kind: "directory" as const },
      { path: "dist", kind: "directory" as const },
      { path: "build", kind: "directory" as const },
      { path: "coverage", kind: "directory" as const },
      { path: "notes.txt", kind: "file" as const },
      { path: "src/nested.sql", kind: "file" as const },
    ];

    expect(projectSqlDirectoryEntries(entries, false).map((entry) => entry.path)).toEqual([
      "src",
      "src/nested.sql",
    ]);
    expect(projectSqlDirectoryEntries(entries, true).map((entry) => entry.path)).toEqual([
      "src",
      ".hidden",
      "node_modules",
      "dist",
      "build",
      "coverage",
      "src/nested.sql",
    ]);
  });
});

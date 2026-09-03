import { describe, expect, it, vi } from "vite-plus/test";

import { sqlLanguageDefinition } from "../../../src/languages/sql/definition";
import { QueryManager } from "../../../src/syntax/tree-sitter/worker/query-manager";
import type { Language, Query } from "web-tree-sitter";

function createLanguage(): Language {
  return {} as Language;
}

function createQuery() {
  const deleteSpy = vi.fn();
  return {
    value: { delete: deleteSpy } as unknown as Query,
    deleteSpy,
  };
}

function response(source = "(statement) @fold"): Response {
  return {
    ok: true,
    status: 200,
    text: async () => source,
  } as Response;
}

describe("QueryManager", () => {
  it("compiles each language query kind once and shares the cached instance", async () => {
    const language = createLanguage();
    const firstQuery = createQuery();
    const secondQuery = createQuery();
    const fetch = vi.fn(async () => response());
    const createQueryMock = vi
      .fn<(language: Language, source: string) => Query>()
      .mockReturnValueOnce(firstQuery.value)
      .mockReturnValueOnce(secondQuery.value);
    const manager = new QueryManager({
      definition: sqlLanguageDefinition,
      loadLanguage: async () => language,
      dependencies: { fetch, createQuery: createQueryMock },
    });

    const [first, second] = await Promise.all([
      manager.getQuery("folds"),
      manager.getQuery("folds"),
    ]);
    await manager.getQuery("highlights");

    expect(first).toBe(firstQuery.value);
    expect(second).toBe(firstQuery.value);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(createQueryMock).toHaveBeenCalledTimes(2);
    expect(manager.cachedQueryCount).toBe(2);
    expect(manager.pendingQueryCount).toBe(0);
  });

  it("does not poison the cache after a compile failure and can retry", async () => {
    const language = createLanguage();
    const query = createQuery();
    const createQueryMock = vi
      .fn<(language: Language, source: string) => Query>()
      .mockImplementationOnce(() => {
        throw new Error("temporary compile failure");
      })
      .mockReturnValue(query.value);
    const manager = new QueryManager({
      definition: sqlLanguageDefinition,
      loadLanguage: async () => language,
      dependencies: {
        fetch: vi.fn(async () => response()),
        createQuery: createQueryMock,
      },
    });

    await expect(manager.getQuery("folds")).rejects.toThrow("temporary compile failure");
    await expect(manager.getQuery("folds")).resolves.toBe(query.value);

    expect(createQueryMock).toHaveBeenCalledTimes(2);
    expect(manager.cachedQueryCount).toBe(1);
  });

  it("disposes each compiled query exactly once with its runtime", async () => {
    const query = createQuery();
    const manager = new QueryManager({
      definition: sqlLanguageDefinition,
      loadLanguage: async () => createLanguage(),
      dependencies: {
        fetch: vi.fn(async () => response()),
        createQuery: vi.fn(() => query.value),
      },
    });

    await manager.getQuery("folds");
    manager.dispose();
    manager.dispose();

    expect(query.deleteSpy).toHaveBeenCalledTimes(1);
    expect(manager.cachedQueryCount).toBe(0);
    expect(manager.pendingQueryCount).toBe(0);
    expect(() => manager.getQuery("folds")).toThrow("was disposed");
  });
});

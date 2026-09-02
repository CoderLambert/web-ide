import { describe, expect, it, vi } from "vite-plus/test";

import { sqlLanguageDefinition } from "../../../src/languages/sql/definition";
import { WorkerRuntime } from "../../../src/syntax/tree-sitter/worker/runtime";
import type { Language, Parser } from "web-tree-sitter";

function createLanguage() {
  return { delete: vi.fn() } as unknown as Language;
}

function createParser() {
  const deleteSpy = vi.fn();
  const setLanguageSpy = vi.fn();
  return {
    value: { delete: deleteSpy, setLanguage: setLanguageSpy } as unknown as Parser,
    deleteSpy,
    setLanguageSpy,
  };
}

function createResponse(bytes: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer,
  } as Response;
}

describe("WorkerRuntime", () => {
  it("initializes once and loads SQL through its LanguageDefinition", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const language = createLanguage();
    const parser = createParser();
    const parserInit = vi.fn(async () => undefined);
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(input).toBe(sqlLanguageDefinition.syntax.grammarWasmPath);
      return createResponse(bytes);
    });
    const loadLanguage = vi.fn(async (input: Uint8Array) => {
      expect(input).toEqual(bytes);
      return language;
    });
    const createParserMock = vi.fn(() => parser.value);
    const runtime = new WorkerRuntime({
      parserInit,
      languageDependencies: { fetch, loadLanguage, createParser: createParserMock },
    });

    runtime.registerLanguage(sqlLanguageDefinition);
    const first = await runtime.loadLanguage("sql");
    const second = await runtime.loadLanguage("sql");

    expect(first).toBe(second);
    expect(first.definition).toBe(sqlLanguageDefinition);
    expect(await first.load()).toBe(language);
    expect(await first.getParser()).toBe(parser.value);
    expect(parserInit).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(loadLanguage).toHaveBeenCalledTimes(1);
    expect(createParserMock).toHaveBeenCalledTimes(1);
    expect(parser.setLanguageSpy).toHaveBeenCalledWith(language);
  });

  it("does not retain a failed language load and can retry", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const language = createLanguage();
    const parser = createParser();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValue(createResponse(bytes));
    const loadLanguage = vi.fn(async () => language);
    const runtime = new WorkerRuntime({
      parserInit: vi.fn(async () => undefined),
      languageDependencies: { fetch, loadLanguage, createParser: () => parser.value },
    });

    runtime.registerLanguage(sqlLanguageDefinition);
    await expect(runtime.loadLanguage("sql")).rejects.toThrow("temporary network failure");

    const loaded = await runtime.loadLanguage("sql");

    expect(loaded.definition).toBe(sqlLanguageDefinition);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loadLanguage).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejected Language.load result", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const language = createLanguage();
    const parser = createParser();
    const loadLanguage = vi
      .fn<(input: Uint8Array) => Promise<Language>>()
      .mockRejectedValueOnce(new Error("incompatible grammar"))
      .mockResolvedValue(language);
    const runtime = new WorkerRuntime({
      parserInit: vi.fn(async () => undefined),
      languageDependencies: {
        fetch: vi.fn(async () => createResponse(bytes)),
        loadLanguage,
        createParser: () => parser.value,
      },
    });

    runtime.registerLanguage(sqlLanguageDefinition);
    await expect(runtime.loadLanguage("sql")).rejects.toThrow("incompatible grammar");

    await runtime.loadLanguage("sql");

    expect(loadLanguage).toHaveBeenCalledTimes(2);
  });

  it("disposes the shared parser", async () => {
    const language = createLanguage();
    const parser = createParser();
    const runtime = new WorkerRuntime({
      parserInit: vi.fn(async () => undefined),
      languageDependencies: {
        fetch: vi.fn(async () => createResponse(new Uint8Array([1]))),
        loadLanguage: vi.fn(async () => language),
        createParser: () => parser.value,
      },
    });

    runtime.registerLanguage(sqlLanguageDefinition);
    await runtime.loadLanguage("sql");
    runtime.dispose();
    runtime.dispose();

    expect(parser.deleteSpy).toHaveBeenCalledTimes(1);
    expect(runtime.getLanguageRuntime("sql")).toBeUndefined();
  });
});

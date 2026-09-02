import { describe, expect, it, vi } from "vite-plus/test";

import { sqlLanguageDefinition } from "../../../src/languages/sql/definition";
import type { OpenDocumentInput } from "../../../src/syntax/tree-sitter/worker/document-session";
import {
  DocumentManager,
  DocumentManagerError,
} from "../../../src/syntax/tree-sitter/worker/document-manager";
import { WorkerRuntime } from "../../../src/syntax/tree-sitter/worker/runtime";
import type { Language, Parser, Tree } from "web-tree-sitter";

function createTree() {
  const deleteSpy = vi.fn();
  return {
    value: { delete: deleteSpy } as unknown as Tree,
    deleteSpy,
  };
}

function createManager() {
  const language = {} as Language;
  const parserDeleteSpy = vi.fn();
  const setLanguageSpy = vi.fn();
  const parseSpy = vi.fn<(source: string) => Tree | null>();
  const parser = {
    delete: parserDeleteSpy,
    parse: parseSpy,
    setLanguage: setLanguageSpy,
  } as unknown as Parser;
  const runtime = new WorkerRuntime({
    parserInit: vi.fn(async () => undefined),
    languageDependencies: {
      fetch: vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            arrayBuffer: async () => new Uint8Array([1]).buffer,
          }) as Response,
      ),
      loadLanguage: vi.fn(async () => language),
      createParser: vi.fn(() => parser),
    },
  });
  runtime.registerLanguage(sqlLanguageDefinition);

  return {
    manager: new DocumentManager(runtime),
    parseSpy,
    parserDeleteSpy,
    setLanguageSpy,
  };
}

function openInput(overrides: Partial<OpenDocumentInput> = {}): OpenDocumentInput {
  return {
    documentUri: "file:///workspace/query.sql",
    sessionId: "session-1",
    documentVersion: 1,
    languageId: "sql",
    text: "SELECT 1;",
    ...overrides,
  };
}

describe("DocumentManager", () => {
  it("opens two independent SQL documents with one shared parser", async () => {
    const { manager, parseSpy, setLanguageSpy } = createManager();
    const firstTree = createTree();
    const secondTree = createTree();
    parseSpy.mockReturnValueOnce(firstTree.value).mockReturnValueOnce(secondTree.value);

    const first = await manager.openDocument(openInput());
    const second = await manager.openDocument(
      openInput({
        documentUri: "file:///workspace/other.sql",
        sessionId: "session-2",
        documentVersion: 4,
        text: "SELECT 2;",
      }),
    );

    expect(first).toMatchObject({
      documentUri: "file:///workspace/query.sql",
      sessionId: "session-1",
      documentVersion: 1,
      languageId: "sql",
      textMirror: "SELECT 1;",
      state: "ready",
    });
    expect(second.tree).toBe(secondTree.value);
    expect(manager.getSessionCount()).toBe(2);
    expect(parseSpy).toHaveBeenCalledWith("SELECT 1;");
    expect(parseSpy).toHaveBeenCalledWith("SELECT 2;");
    expect(setLanguageSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an active duplicate URI without replacing its session", async () => {
    const { manager, parseSpy } = createManager();
    const firstTree = createTree();
    parseSpy.mockReturnValue(firstTree.value);
    const first = await manager.openDocument(openInput());

    await expect(
      manager.openDocument(openInput({ sessionId: "session-2", text: "SELECT 2;" })),
    ).rejects.toMatchObject({ code: "DOCUMENT_ALREADY_OPEN" });

    expect(manager.getSession("session-1")).toBe(first);
    expect(manager.getSessionCount()).toBe(1);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it("uses a new session after close and ignores an old close", async () => {
    const { manager, parseSpy } = createManager();
    const firstTree = createTree();
    const secondTree = createTree();
    parseSpy.mockReturnValueOnce(firstTree.value).mockReturnValueOnce(secondTree.value);
    await manager.openDocument(openInput());

    expect(manager.closeDocument("session-1")).toBe(true);
    const reopened = await manager.openDocument(openInput({ sessionId: "session-2" }));

    expect(firstTree.deleteSpy).toHaveBeenCalledTimes(1);
    expect(reopened.sessionId).toBe("session-2");
    expect(reopened.tree).toBe(secondTree.value);
    expect(manager.closeDocument("session-1")).toBe(false);
    expect(manager.getSession("session-2")).toBe(reopened);
    expect(manager.getSessionForUri(reopened.documentUri)).toBe(reopened);
  });

  it("leaves no sessions or trees after repeated open/close", async () => {
    const { manager, parseSpy } = createManager();
    const trees = Array.from({ length: 20 }, createTree);
    parseSpy.mockImplementationOnce(() => trees[0]?.value ?? null);
    for (let index = 1; index < trees.length; index += 1) {
      parseSpy.mockImplementationOnce(() => trees[index]?.value ?? null);
    }

    for (let index = 0; index < trees.length; index += 1) {
      const session = await manager.openDocument(
        openInput({
          documentUri: `file:///workspace/query-${index}.sql`,
          sessionId: `session-${index}`,
        }),
      );
      expect(manager.closeDocument(session.sessionId)).toBe(true);
    }

    expect(manager.getSessionCount()).toBe(0);
    for (const tree of trees) {
      expect(tree.deleteSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("does not create a session when full parsing fails", async () => {
    const { manager, parseSpy } = createManager();
    parseSpy.mockImplementation(() => {
      throw new Error("parser failure");
    });

    await expect(manager.openDocument(openInput())).rejects.toEqual(
      expect.objectContaining({
        code: "PARSE_FAILED",
      }),
    );
    expect(manager.getSessionCount()).toBe(0);
  });

  it("rejects unknown languages before loading a grammar", async () => {
    const { manager } = createManager();

    await expect(manager.openDocument(openInput({ languageId: "unknown" }))).rejects.toBeInstanceOf(
      DocumentManagerError,
    );
    await expect(manager.openDocument(openInput({ languageId: "unknown" }))).rejects.toMatchObject({
      code: "UNKNOWN_LANGUAGE",
    });
  });
});

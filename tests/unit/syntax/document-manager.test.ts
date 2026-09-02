import { describe, expect, it, vi } from "vite-plus/test";

import { sqlLanguageDefinition } from "../../../src/languages/sql/definition";
import type { ApplyChanges, ReplaceDocument } from "../../../src/syntax/tree-sitter/protocol";
import type { OpenDocumentInput } from "../../../src/syntax/tree-sitter/worker/document-session";
import {
  DocumentManager,
  DocumentManagerError,
} from "../../../src/syntax/tree-sitter/worker/document-manager";
import { WorkerRuntime } from "../../../src/syntax/tree-sitter/worker/runtime";
import type { Language, Parser, Range, Tree } from "web-tree-sitter";

function createTree() {
  const deleteSpy = vi.fn();
  const editSpy = vi.fn();
  const getChangedRangesSpy = vi.fn((): Range[] => []);
  return {
    value: {
      delete: deleteSpy,
      edit: editSpy,
      getChangedRanges: getChangedRangesSpy,
      rootNode: { hasError: false },
    } as unknown as Tree,
    deleteSpy,
    editSpy,
    getChangedRangesSpy,
  };
}

function createManager() {
  const language = {} as Language;
  const parserDeleteSpy = vi.fn();
  const setLanguageSpy = vi.fn();
  const parseSpy = vi.fn<(source: string, oldTree?: Tree | null) => Tree | null>();
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

function applyInput(overrides: Partial<ApplyChanges> = {}): ApplyChanges {
  return {
    type: "ApplyChanges" as const,
    protocolVersion: 1 as const,
    workerGeneration: 4,
    requestId: 9,
    sessionId: "session-1",
    documentUri: "file:///workspace/query.sql",
    baseVersion: 1,
    nextVersion: 7,
    changes: [{ rangeOffset: 7, rangeLength: 1, text: "2" }],
    ...overrides,
  };
}

function replaceInput(overrides: Partial<ReplaceDocument> = {}): ReplaceDocument {
  return {
    type: "ReplaceDocument" as const,
    protocolVersion: 1 as const,
    workerGeneration: 4,
    requestId: 10,
    sessionId: "session-1",
    documentUri: "file:///workspace/query.sql",
    documentVersion: 7,
    text: "SELECT 2;",
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

  it("applies an atomic edit transaction and returns UTF-16 changed ranges", async () => {
    const { manager, parseSpy } = createManager();
    const oldTree = createTree();
    const newTree = createTree();
    oldTree.getChangedRangesSpy.mockReturnValue([
      {
        startIndex: 0,
        endIndex: 4,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 4 },
      },
    ]);
    parseSpy.mockReturnValueOnce(oldTree.value).mockReturnValueOnce(newTree.value);
    const session = await manager.openDocument(openInput({ text: "中x" }));

    const result = await manager.applyChanges(
      applyInput({
        changes: [{ rangeOffset: 1, rangeLength: 1, text: "y" }],
      }),
    );

    expect(oldTree.editSpy).toHaveBeenCalledTimes(1);
    expect(oldTree.deleteSpy).toHaveBeenCalledTimes(1);
    expect(session.tree).toBe(newTree.value);
    expect(session.textMirror).toBe("中y");
    expect(session.documentVersion).toBe(7);
    expect(session.state).toBe("ready");
    expect(result).toMatchObject({
      type: "ParseResult",
      requestId: 9,
      documentVersion: 7,
      hasErrors: false,
      changedRanges: [
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 2 },
        },
      ],
    });
  });

  it("leaves a session unchanged when version or edit validation fails", async () => {
    const { manager, parseSpy } = createManager();
    const oldTree = createTree();
    parseSpy.mockReturnValue(oldTree.value);
    const session = await manager.openDocument(openInput());

    await expect(manager.applyChanges(applyInput({ baseVersion: 2 }))).rejects.toMatchObject({
      code: "RESYNC_REQUIRED",
    });
    await expect(
      manager.applyChanges(
        applyInput({
          changes: [
            { rangeOffset: 0, rangeLength: 2, text: "x" },
            { rangeOffset: 1, rangeLength: 1, text: "y" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "RESYNC_REQUIRED" });

    expect(session.tree).toBe(oldTree.value);
    expect(session.textMirror).toBe("SELECT 1;");
    expect(session.documentVersion).toBe(1);
    expect(session.state).toBe("ready");
    expect(oldTree.editSpy).not.toHaveBeenCalled();
  });

  it("marks a session desynced and disposes the old tree after incremental failure", async () => {
    const { manager, parseSpy } = createManager();
    const oldTree = createTree();
    parseSpy.mockReturnValueOnce(oldTree.value).mockImplementationOnce(() => {
      throw new Error("incremental parser failure");
    });
    const session = await manager.openDocument(openInput());

    await expect(manager.applyChanges(applyInput())).rejects.toMatchObject({
      code: "RESYNC_REQUIRED",
    });

    expect(oldTree.editSpy).toHaveBeenCalledTimes(1);
    expect(oldTree.deleteSpy).toHaveBeenCalledTimes(1);
    expect(session.state).toBe("desynced");
    expect(session.documentVersion).toBe(1);
    expect(session.textMirror).toBe("SELECT 1;");

    await expect(manager.applyChanges(applyInput())).rejects.toMatchObject({
      code: "RESYNC_REQUIRED",
    });
    expect(oldTree.editSpy).toHaveBeenCalledTimes(1);
  });

  it("full-resyncs an edited or desynced session from an authoritative CRLF snapshot", async () => {
    const { manager, parseSpy } = createManager();
    const oldTree = createTree();
    const replacementTree = createTree();
    parseSpy
      .mockReturnValueOnce(oldTree.value)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(replacementTree.value);
    const session = await manager.openDocument(openInput());

    await expect(manager.applyChanges(applyInput())).rejects.toMatchObject({
      code: "RESYNC_REQUIRED",
    });
    const result = await manager.replaceDocument(
      replaceInput({
        documentVersion: 42,
        text: "SELECT 2;\r\nWHERE id = 1;",
      }),
    );

    expect(parseSpy).toHaveBeenLastCalledWith("SELECT 2;\r\nWHERE id = 1;");
    expect(oldTree.deleteSpy).toHaveBeenCalledTimes(1);
    expect(session.tree).toBe(replacementTree.value);
    expect(session.textMirror).toBe("SELECT 2;\r\nWHERE id = 1;");
    expect(session.documentVersion).toBe(42);
    expect(session.state).toBe("ready");
    expect(result).toMatchObject({
      type: "ParseResult",
      requestId: 10,
      documentVersion: 42,
      changedRanges: [
        {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 13 },
        },
      ],
    });
  });

  it("rejects stale full snapshots without changing the session", async () => {
    const { manager, parseSpy } = createManager();
    const oldTree = createTree();
    parseSpy.mockReturnValue(oldTree.value);
    const session = await manager.openDocument(openInput());

    await expect(
      manager.replaceDocument(replaceInput({ documentVersion: 0, text: "stale" })),
    ).rejects.toMatchObject({ code: "VERSION_MISMATCH" });

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(session.tree).toBe(oldTree.value);
    expect(session.textMirror).toBe("SELECT 1;");
    expect(session.documentVersion).toBe(1);
    expect(session.state).toBe("ready");
    expect(oldTree.deleteSpy).not.toHaveBeenCalled();
  });

  it("keeps the current state when full parsing fails", async () => {
    const { manager, parseSpy } = createManager();
    const oldTree = createTree();
    parseSpy.mockReturnValueOnce(oldTree.value).mockImplementationOnce(() => {
      throw new Error("full parser failure");
    });
    const session = await manager.openDocument(openInput());

    await expect(
      manager.replaceDocument(replaceInput({ documentVersion: 8, text: "invalid snapshot" })),
    ).rejects.toMatchObject({ code: "PARSE_FAILED" });

    expect(session.tree).toBe(oldTree.value);
    expect(session.textMirror).toBe("SELECT 1;");
    expect(session.documentVersion).toBe(1);
    expect(session.state).toBe("ready");
    expect(oldTree.deleteSpy).not.toHaveBeenCalled();
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

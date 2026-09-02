import { describe, expect, it, vi } from "vite-plus/test";

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import {
  MonacoSyntaxDocumentBinding,
  type SyntaxDocumentClient,
} from "../../../src/editor/monaco/syntax-document-binding";
import type { ParseResult, WorkerResponse } from "../../../src/syntax/tree-sitter/protocol";
import type { TreeSitterClientRequest } from "../../../src/syntax/tree-sitter/client";

type ContentListener = (event: Monaco.editor.IModelContentChangedEvent) => void;
type LanguageListener = (event: Monaco.editor.IModelLanguageChangedEvent) => void;
type DisposeListener = () => void;

class FakeModel {
  readonly uri = { toString: () => "inmemory://binding/query.sql" };
  text = "SELECT 1;";
  languageId = "sql";
  versionId = 1;
  private readonly contentListeners = new Set<ContentListener>();
  private readonly languageListeners = new Set<LanguageListener>();
  private readonly disposeListeners = new Set<DisposeListener>();

  getValue(): string {
    return this.text;
  }

  getLanguageId(): string {
    return this.languageId;
  }

  getVersionId(): number {
    return this.versionId;
  }

  onDidChangeContent(listener: ContentListener): Monaco.IDisposable {
    this.contentListeners.add(listener);
    return { dispose: () => this.contentListeners.delete(listener) };
  }

  onDidChangeLanguage(listener: LanguageListener): Monaco.IDisposable {
    this.languageListeners.add(listener);
    return { dispose: () => this.languageListeners.delete(listener) };
  }

  onWillDispose(listener: DisposeListener): Monaco.IDisposable {
    this.disposeListeners.add(listener);
    return { dispose: () => this.disposeListeners.delete(listener) };
  }

  emitContent(event: Monaco.editor.IModelContentChangedEvent): void {
    for (const listener of this.contentListeners) {
      listener(event);
    }
  }

  emitLanguageChange(event: Monaco.editor.IModelLanguageChangedEvent): void {
    for (const listener of this.languageListeners) {
      listener(event);
    }
  }

  emitDispose(): void {
    for (const listener of this.disposeListeners) {
      listener();
    }
  }
}

class FakeClient implements SyntaxDocumentClient {
  readonly requests: TreeSitterClientRequest[] = [];
  readonly sent: TreeSitterClientRequest[] = [];
  readonly requestSpy = vi.fn((request: TreeSitterClientRequest) => {
    this.requests.push(request);
    return Promise.resolve(parseResult(request));
  });
  readonly sendSpy = vi.fn((request: TreeSitterClientRequest) => {
    this.sent.push(request);
  });

  request(request: TreeSitterClientRequest): Promise<WorkerResponse> {
    return this.requestSpy(request);
  }

  send(request: TreeSitterClientRequest): void {
    this.sendSpy(request);
  }
}

function parseResult(request: TreeSitterClientRequest): ParseResult {
  const documentVersion =
    request.type === "ApplyChanges" ? request.nextVersion : request.documentVersion;
  return {
    type: "ParseResult",
    protocolVersion: 1,
    workerGeneration: 1,
    requestId: 1,
    sessionId: request.sessionId,
    documentUri: request.documentUri,
    documentVersion,
    parseTimeMs: 2,
    hasErrors: false,
    changedRanges: [],
  };
}

function contentEvent(
  versionId: number,
  overrides: Partial<Monaco.editor.IModelContentChangedEvent> = {},
): Monaco.editor.IModelContentChangedEvent {
  return {
    changes: [
      {
        range: {} as Monaco.IRange,
        rangeOffset: 7,
        rangeLength: 1,
        text: "2",
      },
    ],
    eol: "\n",
    versionId,
    isUndoing: false,
    isRedoing: false,
    isFlush: false,
    isEolChange: false,
    detailedReasonsChangeLengths: [1],
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("MonacoSyntaxDocumentBinding", () => {
  it("opens the current model and forwards real versioned incremental changes", async () => {
    const model = new FakeModel();
    const client = new FakeClient();
    const binding = new MonacoSyntaxDocumentBinding({
      model: model as unknown as Monaco.editor.ITextModel,
      client,
      createSessionId: () => "session-1",
    });
    await settle();

    expect(client.requests[0]).toEqual({
      type: "OpenDocument",
      sessionId: "session-1",
      documentUri: "inmemory://binding/query.sql",
      documentVersion: 1,
      languageId: "sql",
      text: "SELECT 1;",
    });
    expect(binding.state).toBe("ready");

    model.text = "SELECT 2;";
    model.versionId = 9;
    model.emitContent(contentEvent(9));

    expect(client.requests[1]).toEqual({
      type: "ApplyChanges",
      sessionId: "session-1",
      documentUri: "inmemory://binding/query.sql",
      baseVersion: 1,
      nextVersion: 9,
      changes: [{ rangeOffset: 7, rangeLength: 1, text: "2" }],
    });
    await settle();
    expect(binding.snapshot).toMatchObject({
      state: "ready",
      documentVersion: 9,
      parseTimeMs: 2,
      hasErrors: false,
    });
    binding.dispose();
  });

  it("uses full snapshots for flush and EOL changes", async () => {
    const model = new FakeModel();
    const client = new FakeClient();
    const binding = new MonacoSyntaxDocumentBinding({
      model: model as unknown as Monaco.editor.ITextModel,
      client,
      createSessionId: () => "session-1",
    });
    await settle();

    model.text = "SELECT 2;\r\n";
    model.versionId = 12;
    model.emitContent(contentEvent(12, { isFlush: true, eol: "\r\n" }));
    model.text = "SELECT 2;\r\nWHERE id = 1;";
    model.versionId = 13;
    model.emitContent(contentEvent(13, { isEolChange: true, eol: "\r\n" }));

    expect(client.requests.slice(1)).toEqual([
      {
        type: "ReplaceDocument",
        sessionId: "session-1",
        documentUri: "inmemory://binding/query.sql",
        documentVersion: 12,
        text: "SELECT 2;\r\n",
      },
      {
        type: "ReplaceDocument",
        sessionId: "session-1",
        documentUri: "inmemory://binding/query.sql",
        documentVersion: 13,
        text: "SELECT 2;\r\nWHERE id = 1;",
      },
    ]);
    binding.dispose();
  });

  it("closes the old session before reopening after a language change", async () => {
    const model = new FakeModel();
    const client = new FakeClient();
    let sessionNumber = 0;
    const binding = new MonacoSyntaxDocumentBinding({
      model: model as unknown as Monaco.editor.ITextModel,
      client,
      createSessionId: () => `session-${++sessionNumber}`,
    });
    await settle();

    model.languageId = "json";
    model.emitLanguageChange({ oldLanguage: "sql", newLanguage: "json", source: "test" });

    expect(client.sent).toEqual([
      {
        type: "CloseDocument",
        sessionId: "session-1",
        documentUri: "inmemory://binding/query.sql",
        documentVersion: 1,
      },
    ]);
    expect(client.requests[1]).toMatchObject({
      type: "OpenDocument",
      sessionId: "session-2",
      languageId: "json",
      documentVersion: 1,
      text: "SELECT 1;",
    });
    expect(binding.sessionId).toBe("session-2");
    binding.dispose();
  });

  it("resyncs from the latest model snapshot after an incremental failure", async () => {
    const model = new FakeModel();
    const client = new FakeClient();
    client.requestSpy.mockImplementation((request) => {
      client.requests.push(request);
      if (request.type === "ApplyChanges") {
        return Promise.reject({ code: "RESYNC_REQUIRED", message: "incremental failed" });
      }
      return Promise.resolve(parseResult(request));
    });
    const binding = new MonacoSyntaxDocumentBinding({
      model: model as unknown as Monaco.editor.ITextModel,
      client,
      createSessionId: () => "session-1",
    });
    await settle();

    model.text = "SELECT 2;";
    model.versionId = 9;
    model.emitContent(contentEvent(9));
    await settle();

    expect(client.requests[2]).toEqual({
      type: "ReplaceDocument",
      sessionId: "session-1",
      documentUri: "inmemory://binding/query.sql",
      documentVersion: 9,
      text: "SELECT 2;",
    });
    expect(binding.state).toBe("ready");
    binding.dispose();
  });

  it("sends one fire-and-forget close on model disposal", async () => {
    const model = new FakeModel();
    const client = new FakeClient();
    const binding = new MonacoSyntaxDocumentBinding({
      model: model as unknown as Monaco.editor.ITextModel,
      client,
      createSessionId: () => "session-1",
    });
    await settle();

    model.emitDispose();
    model.emitDispose();
    binding.dispose();

    expect(client.sent).toEqual([
      {
        type: "CloseDocument",
        sessionId: "session-1",
        documentUri: "inmemory://binding/query.sql",
        documentVersion: 1,
      },
    ]);
    expect(binding.state).toBe("closed");
  });
});

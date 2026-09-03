import { describe, expect, it, vi } from "vite-plus/test";

import {
  DocumentSyntaxCapabilityRegistry,
  type DocumentSyntaxCapabilities,
} from "../../../src/editor/monaco/document-capability-registry";
import {
  createSemanticHighlightProvider,
  HighlightCoordinator,
  registerSemanticHighlightProvider,
} from "../../../src/editor/monaco/highlight-coordinator";
import {
  createFoldingRangeProvider,
  FoldingCoordinator,
  registerFoldingRangeProvider,
} from "../../../src/editor/monaco/folding-provider";
import {
  createSelectionRangeProvider,
  registerSelectionRangeProvider,
  SelectionCoordinator,
} from "../../../src/editor/monaco/selection-provider";
import type { SyntaxSelectionPath } from "../../../src/syntax/types";
import type { TreeSitterClientRequest } from "../../../src/syntax/tree-sitter/client";
import type {
  FoldingRangesResult,
  HighlightsResult,
  SelectionRangesResult,
  WorkerResponse,
} from "../../../src/syntax/tree-sitter/protocol";

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}

class FakeEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  readonly event = (listener: (value: T) => void): { dispose(): void } => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

function deferredClient() {
  const requests: TreeSitterClientRequest[] = [];
  const pending: Array<Deferred<WorkerResponse>> = [];
  return {
    requests,
    pending,
    request: vi.fn((request: TreeSitterClientRequest) => {
      requests.push(request);
      const deferred = new Deferred<WorkerResponse>();
      pending.push(deferred);
      return deferred.promise;
    }),
  };
}

interface FakeModel {
  uri: { toString(): string };
  getVersionId(): number;
  getLineCount(): number;
  getLineLength(lineNumber: number): number;
}

interface TestDocument {
  model: FakeModel;
  capabilities: DocumentSyntaxCapabilities;
  highlightClient: ReturnType<typeof deferredClient>;
  foldingClient: ReturnType<typeof deferredClient>;
  selectionClient: ReturnType<typeof deferredClient>;
}

function createDocument(uri: string, sessionId: string): TestDocument {
  const highlightClient = deferredClient();
  const foldingClient = deferredClient();
  const selectionClient = deferredClient();
  let version = 1;
  const model: FakeModel = {
    uri: { toString: () => uri },
    getVersionId: () => version,
    getLineCount: () => 1,
    getLineLength: () => 64,
  };

  return {
    model,
    highlightClient,
    foldingClient,
    selectionClient,
    capabilities: {
      highlight: new HighlightCoordinator({
        client: highlightClient,
        sessionId,
        documentUri: uri,
        getDocumentVersion: () => version,
      }),
      folding: new FoldingCoordinator({
        client: foldingClient,
        sessionId,
        documentUri: uri,
        getDocumentVersion: () => version,
      }),
      selection: new SelectionCoordinator({
        client: selectionClient,
        sessionId,
        documentUri: uri,
        getDocumentVersion: () => version,
      }),
    },
  };
}

function highlightResult(document: TestDocument): HighlightsResult {
  return {
    type: "HighlightsResult",
    protocolVersion: 1,
    workerGeneration: 1,
    requestId: 1,
    sessionId: document.highlightClient.requests[0]?.sessionId ?? "",
    documentUri: document.model.uri.toString(),
    documentVersion: 1,
    tokens: [],
  };
}

function foldingResult(document: TestDocument): FoldingRangesResult {
  return {
    type: "FoldingRangesResult",
    protocolVersion: 1,
    workerGeneration: 1,
    requestId: 1,
    sessionId: document.foldingClient.requests[0]?.sessionId ?? "",
    documentUri: document.model.uri.toString(),
    documentVersion: 1,
    ranges: [],
  };
}

function selectionResult(document: TestDocument): SelectionRangesResult {
  const selections: SyntaxSelectionPath[] = [{ ranges: [] }];
  return {
    type: "SelectionRangesResult",
    protocolVersion: 1,
    workerGeneration: 1,
    requestId: 1,
    sessionId: document.selectionClient.requests[0]?.sessionId ?? "",
    documentUri: document.model.uri.toString(),
    documentVersion: 1,
    selections,
  };
}

function monacoRuntime() {
  return {
    Emitter: FakeEmitter,
    languages: {
      registerDocumentSemanticTokensProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerFoldingRangeProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerSelectionRangeProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
  } as never;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("DocumentSyntaxCapabilityRegistry", () => {
  it("routes every SQL provider by model URI when document versions match", async () => {
    const registry = new DocumentSyntaxCapabilityRegistry();
    const first = createDocument("inmemory://A.sql", "session-A");
    const second = createDocument("inmemory://B.sql", "session-B");
    registry.register(first.model.uri.toString(), first.capabilities);
    registry.register(second.model.uri.toString(), second.capabilities);
    const monaco = monacoRuntime();

    const highlightProvider = createSemanticHighlightProvider(monaco, registry);
    const foldingProvider = createFoldingRangeProvider(monaco, registry);
    const selectionProvider = createSelectionRangeProvider(registry);

    highlightProvider.provideDocumentSemanticTokens(first.model as never, null, {} as never);
    highlightProvider.provideDocumentSemanticTokens(second.model as never, null, {} as never);
    foldingProvider.provideFoldingRanges(first.model as never, {} as never, {} as never);
    foldingProvider.provideFoldingRanges(second.model as never, {} as never, {} as never);
    const firstSelection = selectionProvider.provideSelectionRanges(
      first.model as never,
      [{ lineNumber: 1, column: 2 }] as never,
      {} as never,
    );
    const secondSelection = selectionProvider.provideSelectionRanges(
      second.model as never,
      [{ lineNumber: 1, column: 3 }] as never,
      {} as never,
    );

    expect(first.highlightClient.requests[0]).toMatchObject({
      sessionId: "session-A",
      documentUri: "inmemory://A.sql",
      expectedVersion: 1,
    });
    expect(second.highlightClient.requests[0]).toMatchObject({
      sessionId: "session-B",
      documentUri: "inmemory://B.sql",
      expectedVersion: 1,
    });
    expect(first.foldingClient.requests[0]).toMatchObject({
      sessionId: "session-A",
      documentUri: "inmemory://A.sql",
    });
    expect(second.foldingClient.requests[0]).toMatchObject({
      sessionId: "session-B",
      documentUri: "inmemory://B.sql",
    });
    expect(first.selectionClient.requests[0]).toMatchObject({
      sessionId: "session-A",
      documentUri: "inmemory://A.sql",
      positions: [{ line: 0, character: 1 }],
    });
    expect(second.selectionClient.requests[0]).toMatchObject({
      sessionId: "session-B",
      documentUri: "inmemory://B.sql",
      positions: [{ line: 0, character: 2 }],
    });

    first.highlightClient.pending[0]?.resolve(highlightResult(first));
    second.highlightClient.pending[0]?.resolve(highlightResult(second));
    first.foldingClient.pending[0]?.resolve(foldingResult(first));
    second.foldingClient.pending[0]?.resolve(foldingResult(second));
    first.selectionClient.pending[0]?.resolve(selectionResult(first));
    second.selectionClient.pending[0]?.resolve(selectionResult(second));
    await Promise.all([firstSelection, secondSelection]);
    await flushPromises();

    highlightProvider.dispose();
    foldingProvider.dispose();
    selectionProvider.dispose();
  });

  it("unregisters a closed document without allowing a stale result to refresh another document", async () => {
    const registry = new DocumentSyntaxCapabilityRegistry();
    const first = createDocument("inmemory://A.sql", "session-A");
    const second = createDocument("inmemory://B.sql", "session-B");
    const firstRegistration = registry.register(first.model.uri.toString(), first.capabilities);
    registry.register(second.model.uri.toString(), second.capabilities);
    const provider = createSemanticHighlightProvider(monacoRuntime(), registry);
    const changes = vi.fn();
    provider.onDidChange?.(changes as never);

    provider.provideDocumentSemanticTokens(first.model as never, null, {} as never);
    firstRegistration.dispose();
    first.capabilities.highlight.dispose();
    first.capabilities.folding.dispose();
    first.capabilities.selection.dispose();

    expect(registry.get("inmemory://A.sql")).toBeUndefined();
    expect(provider.provideDocumentSemanticTokens(first.model as never, null, {} as never)).toEqual(
      {
        resultId: "1",
        data: new Uint32Array(),
      },
    );

    first.highlightClient.pending[0]?.resolve(highlightResult(first));
    provider.provideDocumentSemanticTokens(second.model as never, null, {} as never);
    second.highlightClient.pending[0]?.resolve(highlightResult(second));
    await flushPromises();

    expect(changes).toHaveBeenCalledTimes(1);
    expect(second.highlightClient.requests[0]).toMatchObject({
      sessionId: "session-B",
      documentUri: "inmemory://B.sql",
    });
    provider.dispose();
  });

  it("keeps a newer registration alive when an older disposable is released", () => {
    const registry = new DocumentSyntaxCapabilityRegistry();
    const first = createDocument("inmemory://same.sql", "session-A");
    const second = createDocument("inmemory://same.sql", "session-B");
    const oldRegistration = registry.register("inmemory://same.sql", first.capabilities);
    const newRegistration = registry.register("inmemory://same.sql", second.capabilities);

    oldRegistration.dispose();
    expect(registry.get("inmemory://same.sql")).toBe(second.capabilities);
    newRegistration.dispose();
    expect(registry.get("inmemory://same.sql")).toBeUndefined();
  });

  it("registers one language-scoped provider per capability", () => {
    const registry = new DocumentSyntaxCapabilityRegistry();
    const monaco = monacoRuntime() as {
      languages: {
        registerDocumentSemanticTokensProvider: ReturnType<typeof vi.fn>;
        registerFoldingRangeProvider: ReturnType<typeof vi.fn>;
        registerSelectionRangeProvider: ReturnType<typeof vi.fn>;
      };
    };

    const highlightRegistration = registerSemanticHighlightProvider(
      monaco as never,
      "sql",
      registry,
    );
    const foldingRegistration = registerFoldingRangeProvider(monaco as never, "sql", registry);
    const selectionRegistration = registerSelectionRangeProvider(monaco as never, "sql", registry);
    expect(monaco.languages.registerDocumentSemanticTokensProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.registerFoldingRangeProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.registerSelectionRangeProvider).toHaveBeenCalledTimes(1);
    highlightRegistration.dispose();
    foldingRegistration.dispose();
    selectionRegistration.dispose();
  });
});

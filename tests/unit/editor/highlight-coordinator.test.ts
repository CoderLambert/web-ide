import { describe, expect, it, vi } from "vite-plus/test";

import {
  HighlightCoordinator,
  createSemanticHighlightProvider,
} from "../../../src/editor/monaco/highlight-coordinator";
import { DocumentSyntaxCapabilityRegistry } from "../../../src/editor/monaco/document-capability-registry";
import { SYNTAX_TOKEN_TYPES, type SyntaxToken } from "../../../src/syntax/types";
import type { HighlightsResult, WorkerResponse } from "../../../src/syntax/tree-sitter/protocol";
import type { TreeSitterClientRequest } from "../../../src/syntax/tree-sitter/client";

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
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

function result(version: number, tokens: SyntaxToken[] = []): HighlightsResult {
  return {
    type: "HighlightsResult",
    protocolVersion: 1,
    workerGeneration: 1,
    requestId: 1,
    sessionId: "session-1",
    documentUri: "opaque://query.sql",
    documentVersion: version,
    tokens,
  };
}

function createClient() {
  const requests: TreeSitterClientRequest[] = [];
  const deferred: Array<Deferred<WorkerResponse>> = [];
  return {
    requests,
    deferred,
    request: vi.fn((request: TreeSitterClientRequest) => {
      requests.push(request);
      const pending = new Deferred<WorkerResponse>();
      deferred.push(pending);
      return pending.promise;
    }),
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function registryFor(coordinator: HighlightCoordinator): DocumentSyntaxCapabilityRegistry {
  const registry = new DocumentSyntaxCapabilityRegistry();
  registry.register("opaque://query.sql", {
    highlight: coordinator,
    folding: {} as never,
    selection: {} as never,
  });
  return registry;
}

describe("HighlightCoordinator", () => {
  it("bounds derived requests and follows only the latest version", async () => {
    let version = 1;
    const client = createClient();
    const applied: number[] = [];
    const coordinator = new HighlightCoordinator({
      client,
      sessionId: "session-1",
      documentUri: "opaque://query.sql",
      getDocumentVersion: () => version,
      onError: (error) => {
        throw error;
      },
    });
    coordinator.onDidChange(() => applied.push(coordinator.tokensVersion ?? -1));

    coordinator.requestLatest(1);
    version = 3;
    coordinator.requestLatest(2);
    coordinator.requestLatest(3);

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).toMatchObject({ type: "GetHighlights", expectedVersion: 1 });

    client.deferred[0]?.resolve(result(1));
    await flushPromises();

    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]).toMatchObject({ type: "GetHighlights", expectedVersion: 3 });
    client.deferred[1]?.resolve(result(3));
    await flushPromises();

    expect(applied).toEqual([3]);
    expect(coordinator.tokensVersion).toBe(3);
    expect(coordinator.inFlight).toBe(false);
  });

  it("does not publish stale results and can retry after a client error", async () => {
    let version = 1;
    const client = createClient();
    const onError = vi.fn();
    const coordinator = new HighlightCoordinator({
      client,
      sessionId: "session-1",
      documentUri: "opaque://query.sql",
      getDocumentVersion: () => version,
      onError,
    });

    coordinator.requestLatest();
    client.deferred[0]?.reject(new Error("worker restarted"));
    await flushPromises();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(coordinator.inFlight).toBe(false);

    version = 2;
    coordinator.requestLatest();
    client.deferred[1]?.resolve(result(1));
    await flushPromises();

    expect(coordinator.tokensVersion).toBeUndefined();
    expect(coordinator.getTokens(2)).toEqual([]);
  });

  it("adapts stable tokens to Monaco semantic token data", async () => {
    let version = 1;
    const client = createClient();
    const token: SyntaxToken = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 6 },
      },
      type: "keyword",
    };
    const coordinator = new HighlightCoordinator({
      client,
      sessionId: "session-1",
      documentUri: "opaque://query.sql",
      getDocumentVersion: () => version,
    });
    const monaco = { Emitter: FakeEmitter } as never;
    const provider = createSemanticHighlightProvider(monaco, registryFor(coordinator));
    coordinator.requestLatest();
    client.deferred[0]?.resolve(result(1, [token]));
    await flushPromises();

    const semanticTokens = provider.provideDocumentSemanticTokens(
      {
        getVersionId: () => version,
        uri: { toString: () => "opaque://query.sql" },
        getLineCount: () => 1,
        getLineLength: () => 6,
      } as never,
      null,
      {} as never,
    );
    expect(semanticTokens).toMatchObject({
      resultId: "1",
      data: new Uint32Array([0, 0, 6, 0, 0]),
    });
    provider.dispose();
    version = 2;
  });

  it("splits multiline tokens into sorted single-line semantic tokens", async () => {
    let version = 1;
    const client = createClient();
    const coordinator = new HighlightCoordinator({
      client,
      sessionId: "session-1",
      documentUri: "opaque://query.sql",
      getDocumentVersion: () => version,
    });
    const monaco = { Emitter: FakeEmitter } as never;
    const provider = createSemanticHighlightProvider(monaco, registryFor(coordinator));
    const commentType = SYNTAX_TOKEN_TYPES.indexOf("comment");
    const token: SyntaxToken = {
      range: {
        start: { line: 0, character: 2 },
        end: { line: 2, character: 3 },
      },
      type: "comment",
    };
    coordinator.requestLatest();
    client.deferred[0]?.resolve(result(1, [token]));
    await flushPromises();

    const semanticTokens = provider.provideDocumentSemanticTokens(
      {
        getVersionId: () => version,
        uri: { toString: () => "opaque://query.sql" },
        getLineCount: () => 3,
        getLineLength: (lineNumber: number) => [6, 4, 5][lineNumber - 1] ?? 0,
      } as never,
      null,
      {} as never,
    );

    expect(semanticTokens).toMatchObject({
      resultId: "1",
      data: new Uint32Array([
        0,
        2,
        4,
        commentType,
        0,
        1,
        0,
        4,
        commentType,
        0,
        1,
        0,
        3,
        commentType,
        0,
      ]),
    });
    provider.dispose();
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  FoldingCoordinator,
  createFoldingRangeProvider,
} from "../../../src/editor/monaco/folding-provider";
import { DocumentSyntaxCapabilityRegistry } from "../../../src/editor/monaco/document-capability-registry";
import type { SyntaxFoldingRange } from "../../../src/syntax/types";
import type { FoldingRangesResult, WorkerResponse } from "../../../src/syntax/tree-sitter/protocol";
import type { TreeSitterClientRequest } from "../../../src/syntax/tree-sitter/client";

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
  readonly listeners = new Set<(value: T) => void>();
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

function result(version: number, ranges: SyntaxFoldingRange[] = []): FoldingRangesResult {
  return {
    type: "FoldingRangesResult",
    protocolVersion: 1,
    workerGeneration: 1,
    requestId: 1,
    sessionId: "session-1",
    documentUri: "opaque://query.sql",
    documentVersion: version,
    ranges,
  };
}

describe("FoldingCoordinator", () => {
  it("discards stale ranges and publishes only the current version", async () => {
    let version = 1;
    const deferred: Array<Deferred<WorkerResponse>> = [];
    const requests: TreeSitterClientRequest[] = [];
    const client = {
      request: (request: TreeSitterClientRequest) => {
        requests.push(request);
        const pending = new Deferred<WorkerResponse>();
        deferred.push(pending);
        return pending.promise;
      },
    };
    const coordinator = new FoldingCoordinator({
      client,
      sessionId: "session-1",
      documentUri: "opaque://query.sql",
      getDocumentVersion: () => version,
    });

    coordinator.requestLatest(1);
    version = 2;
    coordinator.requestLatest(2);
    deferred[0]?.resolve(result(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ type: "GetFoldingRanges", expectedVersion: 2 });
    deferred[1]?.resolve(
      result(2, [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 2, character: 1 },
          },
        },
      ]),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(coordinator.rangesVersion).toBe(2);
    expect(coordinator.getRanges(2)).toHaveLength(1);
  });

  it("adapts stable folding DTOs to Monaco's one-based line provider", async () => {
    let version = 1;
    const pending = new Deferred<WorkerResponse>();
    const coordinator = new FoldingCoordinator({
      client: { request: () => pending.promise },
      sessionId: "session-1",
      documentUri: "opaque://query.sql",
      getDocumentVersion: () => version,
    });
    const monaco = { Emitter: FakeEmitter } as never;
    const registry = new DocumentSyntaxCapabilityRegistry();
    registry.register("opaque://query.sql", {
      highlight: {} as never,
      folding: coordinator,
      selection: {} as never,
    });
    const provider = createFoldingRangeProvider(monaco, registry);
    coordinator.requestLatest();
    pending.resolve(
      result(1, [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 2, character: 1 },
          },
        },
      ]),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      provider.provideFoldingRanges(
        {
          getVersionId: () => version,
          uri: { toString: () => "opaque://query.sql" },
        } as never,
        {} as never,
        {} as never,
      ),
    ).toEqual([{ start: 1, end: 3, deleteCount: 0 }]);
    provider.dispose();
  });
});

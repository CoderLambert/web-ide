import { describe, expect, it, vi } from "vite-plus/test";

import {
  SelectionCoordinator,
  createSelectionRangeProvider,
} from "../../../src/editor/monaco/selection-provider";
import type { SyntaxSelectionPath } from "../../../src/syntax/types";
import type {
  SelectionRangesResult,
  WorkerResponse,
} from "../../../src/syntax/tree-sitter/protocol";
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

function result(version: number, selections: SyntaxSelectionPath[] = []): SelectionRangesResult {
  return {
    type: "SelectionRangesResult",
    protocolVersion: 1,
    workerGeneration: 1,
    requestId: 1,
    sessionId: "session-1",
    documentUri: "opaque://query.sql",
    documentVersion: version,
    selections,
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SelectionCoordinator", () => {
  it("bounds requests and discards stale versions", async () => {
    let version = 1;
    const requests: TreeSitterClientRequest[] = [];
    const deferred: Array<Deferred<WorkerResponse>> = [];
    const client = {
      request: vi.fn((request: TreeSitterClientRequest) => {
        requests.push(request);
        const pending = new Deferred<WorkerResponse>();
        deferred.push(pending);
        return pending.promise;
      }),
    };
    const coordinator = new SelectionCoordinator({
      client,
      sessionId: "session-1",
      documentUri: "opaque://query.sql",
      getDocumentVersion: () => version,
    });

    const first = coordinator.request(1, [{ line: 0, character: 1 }]);
    version = 2;
    const second = coordinator.request(2, [{ line: 0, character: 2 }]);
    expect(requests).toHaveLength(1);
    deferred[0]?.resolve(result(1, [{ ranges: [] }]));
    await flushPromises();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ type: "GetSelectionRanges", expectedVersion: 2 });
    expect(await first).toEqual([{ ranges: [] }]);

    deferred[1]?.resolve(
      result(2, [
        {
          ranges: [
            {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 2 },
            },
          ],
        },
      ]),
    );
    await flushPromises();
    expect(await second).toHaveLength(1);
  });

  it("maps stable DTO ranges to Monaco's one-based selection ranges", async () => {
    let version = 1;
    const pending = new Deferred<WorkerResponse>();
    const coordinator = new SelectionCoordinator({
      client: { request: () => pending.promise },
      sessionId: "session-1",
      documentUri: "opaque://query.sql",
      getDocumentVersion: () => version,
    });
    const provider = createSelectionRangeProvider(coordinator);
    const resultPromise = provider.provideSelectionRanges(
      { getVersionId: () => version } as never,
      [{ lineNumber: 1, column: 2 }] as never,
      {} as never,
    );
    pending.resolve(
      result(1, [
        {
          ranges: [
            {
              start: { line: 0, character: 0 },
              end: { line: 1, character: 3 },
            },
          ],
        },
      ]),
    );

    await expect(resultPromise).resolves.toEqual([
      [
        {
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 2,
            endColumn: 4,
          },
        },
      ],
    ]);
    provider.dispose();
  });
});

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type { SyntaxSelectionPath, TextPosition, TextRange } from "../../syntax/types";
import type { TreeSitterClientRequest } from "../../syntax/tree-sitter/client";
import type { SelectionRangesResult, WorkerResponse } from "../../syntax/tree-sitter/protocol";

export interface SelectionCapabilityClient {
  request(request: TreeSitterClientRequest): Promise<WorkerResponse>;
}

export interface SelectionCoordinatorOptions {
  client: SelectionCapabilityClient;
  sessionId: string;
  documentUri: string;
  getDocumentVersion: () => number;
  onError?: (error: unknown) => void;
}

interface PendingSelectionRequest {
  version: number;
  positions: TextPosition[];
  resolve: (selections: SyntaxSelectionPath[]) => void;
}

function isSelectionResult(response: WorkerResponse): response is SelectionRangesResult {
  return response.type === "SelectionRangesResult";
}

function emptySelections(positions: readonly TextPosition[]): SyntaxSelectionPath[] {
  return positions.map(() => ({ ranges: [] }));
}

export class SelectionCoordinator {
  private readonly client: SelectionCapabilityClient;
  private readonly sessionId: string;
  private readonly documentUri: string;
  private readonly getDocumentVersion: () => number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private inFlight: PendingSelectionRequest | undefined;
  private latest: PendingSelectionRequest | undefined;
  private disposed = false;

  constructor(options: SelectionCoordinatorOptions) {
    this.client = options.client;
    this.sessionId = options.sessionId;
    this.documentUri = options.documentUri;
    this.getDocumentVersion = options.getDocumentVersion;
    this.onError = options.onError;
  }

  request(version: number, positions: readonly TextPosition[]): Promise<SyntaxSelectionPath[]> {
    if (this.disposed) {
      return Promise.resolve(emptySelections(positions));
    }
    if (!Number.isInteger(version) || version < 0) {
      const error = new Error("Selection document version must be a non-negative integer.");
      this.onError?.(error);
      return Promise.resolve(emptySelections(positions));
    }

    this.latest?.resolve(emptySelections(this.latest.positions));
    const pending: PendingSelectionRequest = {
      version,
      positions: [...positions],
      resolve: () => undefined,
    };
    const promise = new Promise<SyntaxSelectionPath[]>((resolve) => {
      pending.resolve = resolve;
    });
    this.latest = pending;
    this.startLatestRequest();
    return promise;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.latest?.resolve(emptySelections(this.latest.positions));
    this.latest = undefined;
    this.inFlight?.resolve(emptySelections(this.inFlight.positions));
    this.inFlight = undefined;
  }

  private startLatestRequest(): void {
    if (this.disposed || this.inFlight !== undefined || this.latest === undefined) {
      return;
    }

    const pending = this.latest;
    this.latest = undefined;
    this.inFlight = pending;
    let responsePromise: Promise<WorkerResponse>;
    try {
      responsePromise = this.client.request({
        type: "GetSelectionRanges",
        sessionId: this.sessionId,
        documentUri: this.documentUri,
        expectedVersion: pending.version,
        positions: pending.positions,
      });
    } catch (error: unknown) {
      this.inFlight = undefined;
      this.onError?.(error);
      pending.resolve(emptySelections(pending.positions));
      this.startLatestRequest();
      return;
    }

    void responsePromise
      .then((response) => {
        if (
          this.disposed ||
          !isSelectionResult(response) ||
          response.sessionId !== this.sessionId ||
          response.documentUri !== this.documentUri ||
          response.documentVersion !== pending.version ||
          this.getDocumentVersion() !== response.documentVersion ||
          response.selections.length !== pending.positions.length
        ) {
          pending.resolve(emptySelections(pending.positions));
          return;
        }

        pending.resolve(response.selections);
      })
      .catch((error: unknown) => {
        if (!this.disposed) {
          this.onError?.(error);
        }
        pending.resolve(emptySelections(pending.positions));
      })
      .finally(() => {
        if (this.inFlight === pending) {
          this.inFlight = undefined;
        }
        this.startLatestRequest();
      });
  }
}

function toMonacoRange(range: TextRange): Monaco.languages.SelectionRange {
  return {
    range: {
      startLineNumber: range.start.line + 1,
      startColumn: range.start.character + 1,
      endLineNumber: range.end.line + 1,
      endColumn: range.end.character + 1,
    },
  };
}

export function createSelectionRangeProvider(
  coordinator: SelectionCoordinator,
): Monaco.languages.SelectionRangeProvider & { dispose(): void } {
  return {
    provideSelectionRanges: (model, positions) =>
      coordinator
        .request(
          model.getVersionId(),
          positions.map(({ lineNumber, column }) => ({
            line: lineNumber - 1,
            character: column - 1,
          })),
        )
        .then((selections) =>
          selections.map((selection) => selection.ranges.map((range) => toMonacoRange(range))),
        ),
    dispose: () => coordinator.dispose(),
  };
}

export function registerSelectionRangeProvider(
  monaco: typeof Monaco,
  languageId: string,
  coordinator: SelectionCoordinator,
): Monaco.IDisposable {
  const provider = createSelectionRangeProvider(coordinator);
  const registration = monaco.languages.registerSelectionRangeProvider(languageId, provider);
  return {
    dispose: () => {
      provider.dispose();
      registration.dispose();
    },
  };
}

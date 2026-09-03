import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type { SyntaxFoldingRange } from "../../syntax/types";
import type { TreeSitterClientRequest } from "../../syntax/tree-sitter/client";
import type { FoldingRangesResult, WorkerResponse } from "../../syntax/tree-sitter/protocol";

export interface FoldingCapabilityClient {
  request(request: TreeSitterClientRequest): Promise<WorkerResponse>;
}

export interface FoldingCoordinatorOptions {
  client: FoldingCapabilityClient;
  sessionId: string;
  documentUri: string;
  getDocumentVersion: () => number;
  onError?: (error: unknown) => void;
}

function isFoldingResult(response: WorkerResponse): response is FoldingRangesResult {
  return response.type === "FoldingRangesResult";
}

export class FoldingCoordinator {
  private readonly client: FoldingCapabilityClient;
  private readonly sessionId: string;
  private readonly documentUri: string;
  private readonly getDocumentVersion: () => number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private latestVersionValue: number | undefined;
  private inFlightVersionValue: number | undefined;
  private rangesValue: SyntaxFoldingRange[] = [];
  private rangesVersionValue: number | undefined;
  private disposed = false;

  constructor(options: FoldingCoordinatorOptions) {
    this.client = options.client;
    this.sessionId = options.sessionId;
    this.documentUri = options.documentUri;
    this.getDocumentVersion = options.getDocumentVersion;
    this.onError = options.onError;
  }

  get inFlight(): boolean {
    return this.inFlightVersionValue !== undefined;
  }

  get rangesVersion(): number | undefined {
    return this.rangesVersionValue;
  }

  requestLatest(version = this.getDocumentVersion()): void {
    if (this.disposed) {
      return;
    }
    if (!Number.isInteger(version) || version < 0) {
      this.onError?.(new Error("Folding document version must be a non-negative integer."));
      return;
    }

    this.latestVersionValue = version;
    if (this.rangesVersionValue === version) {
      return;
    }
    this.startLatestRequest();
  }

  getRanges(version = this.getDocumentVersion()): readonly SyntaxFoldingRange[] {
    return this.rangesVersionValue === version ? this.rangesValue : [];
  }

  onDidChange(listener: () => void): { dispose(): void } {
    if (this.disposed) {
      return { dispose: () => undefined };
    }
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.listeners.clear();
    this.latestVersionValue = undefined;
    this.inFlightVersionValue = undefined;
    this.rangesValue = [];
    this.rangesVersionValue = undefined;
  }

  private startLatestRequest(): void {
    if (this.disposed || this.inFlightVersionValue !== undefined) {
      return;
    }
    const requestedVersion = this.latestVersionValue;
    if (requestedVersion === undefined) {
      return;
    }
    this.inFlightVersionValue = requestedVersion;

    void this.client
      .request({
        type: "GetFoldingRanges",
        sessionId: this.sessionId,
        documentUri: this.documentUri,
        expectedVersion: requestedVersion,
      })
      .then((response) => {
        if (
          this.disposed ||
          !isFoldingResult(response) ||
          response.sessionId !== this.sessionId ||
          response.documentUri !== this.documentUri ||
          response.documentVersion !== requestedVersion ||
          this.getDocumentVersion() !== response.documentVersion
        ) {
          return;
        }

        this.rangesValue = response.ranges;
        this.rangesVersionValue = response.documentVersion;
        for (const listener of this.listeners) {
          listener();
        }
      })
      .catch((error: unknown) => {
        if (!this.disposed) {
          this.onError?.(error);
        }
      })
      .finally(() => {
        if (this.inFlightVersionValue === requestedVersion) {
          this.inFlightVersionValue = undefined;
        }
        if (this.latestVersionValue !== requestedVersion) {
          this.startLatestRequest();
        }
      });
  }
}

export function createFoldingRangeProvider(
  monaco: typeof Monaco,
  coordinator: FoldingCoordinator,
): Monaco.languages.FoldingRangeProvider & { dispose(): void } {
  const emitter = new monaco.Emitter<Monaco.languages.FoldingRangeProvider & { dispose(): void }>();
  const listener = coordinator.onDidChange(() => emitter.fire(provider));
  const provider: Monaco.languages.FoldingRangeProvider & { dispose(): void } = {
    onDidChange: emitter.event,
    provideFoldingRanges: (model) => {
      const version = model.getVersionId();
      coordinator.requestLatest(version);
      return coordinator.getRanges(version).map(({ range }) => ({
        start: range.start.line + 1,
        end: range.end.line + 1,
        deleteCount: 0,
      }));
    },
    dispose: () => {
      listener.dispose();
      emitter.dispose();
    },
  };
  return provider;
}

export function registerFoldingRangeProvider(
  monaco: typeof Monaco,
  languageId: string,
  coordinator: FoldingCoordinator,
): Monaco.IDisposable {
  const provider = createFoldingRangeProvider(monaco, coordinator);
  const registration = monaco.languages.registerFoldingRangeProvider(languageId, provider);
  return {
    dispose: () => {
      provider.dispose();
      registration.dispose();
    },
  };
}

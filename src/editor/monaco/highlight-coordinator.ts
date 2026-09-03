import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type { SyntaxToken } from "../../syntax/types";
import type { TreeSitterClientRequest } from "../../syntax/tree-sitter/client";
import type { HighlightsResult, WorkerResponse } from "../../syntax/tree-sitter/protocol";

export interface HighlightCapabilityClient {
  request(request: TreeSitterClientRequest): Promise<WorkerResponse>;
}

export interface HighlightCoordinatorOptions {
  client: HighlightCapabilityClient;
  sessionId: string;
  documentUri: string;
  getDocumentVersion: () => number;
  onError?: (error: unknown) => void;
}

export interface HighlightCoordinatorListener {
  dispose(): void;
}

function isHighlightsResult(response: WorkerResponse): response is HighlightsResult {
  return response.type === "HighlightsResult";
}

export class HighlightCoordinator {
  private readonly client: HighlightCapabilityClient;
  private readonly sessionId: string;
  private readonly documentUri: string;
  private readonly getDocumentVersion: () => number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private latestVersionValue: number | undefined;
  private inFlightVersionValue: number | undefined;
  private tokensValue: SyntaxToken[] = [];
  private tokensVersionValue: number | undefined;
  private disposed = false;

  constructor(options: HighlightCoordinatorOptions) {
    this.client = options.client;
    this.sessionId = options.sessionId;
    this.documentUri = options.documentUri;
    this.getDocumentVersion = options.getDocumentVersion;
    this.onError = options.onError;
  }

  get inFlight(): boolean {
    return this.inFlightVersionValue !== undefined;
  }

  get latestVersion(): number | undefined {
    return this.latestVersionValue;
  }

  get tokensVersion(): number | undefined {
    return this.tokensVersionValue;
  }

  requestLatest(version = this.getDocumentVersion()): void {
    if (this.disposed) {
      return;
    }
    if (!Number.isInteger(version) || version < 0) {
      this.onError?.(new Error("Highlight document version must be a non-negative integer."));
      return;
    }

    this.latestVersionValue = version;
    if (this.tokensVersionValue === version) {
      return;
    }
    this.startLatestRequest();
  }

  getTokens(version = this.getDocumentVersion()): readonly SyntaxToken[] {
    return this.tokensVersionValue === version ? this.tokensValue : [];
  }

  onDidChange(listener: () => void): HighlightCoordinatorListener {
    if (this.disposed) {
      return { dispose: () => undefined };
    }
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.listeners.clear();
    this.latestVersionValue = undefined;
    this.inFlightVersionValue = undefined;
    this.tokensValue = [];
    this.tokensVersionValue = undefined;
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
        type: "GetHighlights",
        sessionId: this.sessionId,
        documentUri: this.documentUri,
        expectedVersion: requestedVersion,
      })
      .then((response) => {
        if (
          this.disposed ||
          !isHighlightsResult(response) ||
          response.sessionId !== this.sessionId ||
          response.documentUri !== this.documentUri ||
          response.documentVersion !== requestedVersion ||
          this.getDocumentVersion() !== response.documentVersion
        ) {
          return;
        }

        this.tokensValue = response.tokens;
        this.tokensVersionValue = response.documentVersion;
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

const SEMANTIC_TOKEN_TYPES = [
  "keyword",
  "string",
  "number",
  "comment",
  "function",
  "variable",
  "property",
  "type",
  "operator",
  "punctuation",
] as const;

function encodeSemanticTokens(
  tokens: readonly SyntaxToken[],
  version: number,
): Monaco.languages.SemanticTokens {
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (const token of tokens) {
    const tokenType = SEMANTIC_TOKEN_TYPES.indexOf(token.type);
    if (tokenType < 0) {
      continue;
    }
    const deltaLine = token.range.start.line - previousLine;
    const deltaCharacter =
      deltaLine === 0
        ? token.range.start.character - previousCharacter
        : token.range.start.character;
    const length =
      token.range.end.line === token.range.start.line
        ? token.range.end.character - token.range.start.character
        : 0;
    if (deltaLine < 0 || deltaCharacter < 0 || length <= 0) {
      continue;
    }
    data.push(deltaLine, deltaCharacter, length, tokenType, 0);
    previousLine = token.range.start.line;
    previousCharacter = token.range.start.character;
  }

  return { resultId: String(version), data: new Uint32Array(data) };
}

export function createSemanticHighlightProvider(
  monaco: typeof Monaco,
  coordinator: HighlightCoordinator,
): Monaco.languages.DocumentSemanticTokensProvider & { dispose(): void } {
  const emitter = new monaco.Emitter<void>();
  const listener = coordinator.onDidChange(() => emitter.fire());

  return {
    onDidChange: emitter.event,
    getLegend: () => ({
      tokenTypes: [...SEMANTIC_TOKEN_TYPES],
      tokenModifiers: [],
    }),
    provideDocumentSemanticTokens: (model) => {
      const version = model.getVersionId();
      coordinator.requestLatest(version);
      return encodeSemanticTokens(coordinator.getTokens(version), version);
    },
    releaseDocumentSemanticTokens: () => undefined,
    dispose: () => {
      listener.dispose();
      emitter.dispose();
    },
  };
}

export function registerSemanticHighlightProvider(
  monaco: typeof Monaco,
  languageId: string,
  coordinator: HighlightCoordinator,
): Monaco.IDisposable {
  const provider = createSemanticHighlightProvider(monaco, coordinator);
  const registration = monaco.languages.registerDocumentSemanticTokensProvider(
    languageId,
    provider,
  );
  return {
    dispose: () => {
      provider.dispose();
      registration.dispose();
    },
  };
}

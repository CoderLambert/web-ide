import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import { SYNTAX_TOKEN_TYPES, type SyntaxToken } from "../../syntax/types";
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

interface EncodedTokenCandidate {
  line: number;
  character: number;
  length: number;
  tokenType: number;
}

function encodeSemanticTokens(
  model: Monaco.editor.ITextModel,
  tokens: readonly SyntaxToken[],
  version: number,
): Monaco.languages.SemanticTokens {
  const candidates: EncodedTokenCandidate[] = [];

  for (const token of tokens) {
    const tokenType = SYNTAX_TOKEN_TYPES.indexOf(token.type);
    if (tokenType < 0) {
      continue;
    }

    const { start, end } = token.range;
    if (
      !Number.isInteger(start.line) ||
      !Number.isInteger(start.character) ||
      !Number.isInteger(end.line) ||
      !Number.isInteger(end.character) ||
      start.line < 0 ||
      start.character < 0 ||
      end.line < start.line ||
      end.character < 0 ||
      start.line >= model.getLineCount() ||
      end.line >= model.getLineCount()
    ) {
      continue;
    }

    if (start.line === end.line) {
      const length = end.character - start.character;
      if (length > 0) {
        candidates.push({ line: start.line, character: start.character, length, tokenType });
      }
      continue;
    }

    const firstLineLength = model.getLineLength(start.line + 1) - start.character;
    if (firstLineLength > 0) {
      candidates.push({
        line: start.line,
        character: start.character,
        length: firstLineLength,
        tokenType,
      });
    }

    for (let line = start.line + 1; line < end.line; line += 1) {
      const length = model.getLineLength(line + 1);
      if (length > 0) {
        candidates.push({ line, character: 0, length, tokenType });
      }
    }

    if (end.character > 0) {
      candidates.push({ line: end.line, character: 0, length: end.character, tokenType });
    }
  }

  candidates.sort((left, right) => left.line - right.line || left.character - right.character);

  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (const candidate of candidates) {
    const deltaLine = candidate.line - previousLine;
    const deltaCharacter =
      deltaLine === 0 ? candidate.character - previousCharacter : candidate.character;
    if (deltaLine < 0 || deltaCharacter < 0) {
      continue;
    }
    data.push(deltaLine, deltaCharacter, candidate.length, candidate.tokenType, 0);
    previousLine = candidate.line;
    previousCharacter = candidate.character;
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
      tokenTypes: [...SYNTAX_TOKEN_TYPES],
      tokenModifiers: [],
    }),
    provideDocumentSemanticTokens: (model) => {
      const version = model.getVersionId();
      coordinator.requestLatest(version);
      return encodeSemanticTokens(model, coordinator.getTokens(version), version);
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

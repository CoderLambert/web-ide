import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import {
  TreeSitterClientError,
  type TreeSitterClientRequest,
} from "../../syntax/tree-sitter/client";
import type { ParseResult, WorkerResponse } from "../../syntax/tree-sitter/protocol";

export type MonacoSyntaxBindingState = "opening" | "ready" | "desynced" | "error" | "closed";

export interface MonacoSyntaxBindingSnapshot {
  state: MonacoSyntaxBindingState;
  documentUri: string;
  sessionId: string;
  languageId: string;
  documentVersion: number;
  parseTimeMs: number | undefined;
  hasErrors: boolean | undefined;
}

export interface SyntaxDocumentClient {
  request(request: TreeSitterClientRequest): Promise<WorkerResponse>;
  send(request: TreeSitterClientRequest): void;
}

export type MonacoSyntaxOpenDocumentSnapshot = Extract<
  TreeSitterClientRequest,
  { type: "OpenDocument" }
>;

export interface MonacoSyntaxDocumentBindingOptions {
  model: Monaco.editor.ITextModel;
  client: SyntaxDocumentClient;
  createSessionId?: (documentUri: string) => string;
  onStateChange?: (snapshot: MonacoSyntaxBindingSnapshot) => void;
  onParseResult?: (result: ParseResult) => void;
  onError?: (error: unknown) => void;
}

let nextSessionId = 1;

function defaultSessionId(documentUri: string): string {
  const sessionId = `monaco-${nextSessionId}`;
  nextSessionId += 1;
  return `${sessionId}-${documentUri}`;
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof TreeSitterClientError) {
    return error.code;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

function shouldFullResync(error: unknown): boolean {
  return ["PARSE_FAILED", "RESYNC_REQUIRED", "SESSION_NOT_FOUND", "VERSION_MISMATCH"].includes(
    errorCode(error) ?? "",
  );
}

export class MonacoSyntaxDocumentBinding {
  private readonly model: Monaco.editor.ITextModel;
  private readonly client: SyntaxDocumentClient;
  private readonly documentUri: string;
  private readonly createSessionId: (documentUri: string) => string;
  private readonly onStateChange: ((snapshot: MonacoSyntaxBindingSnapshot) => void) | undefined;
  private readonly onParseResult: ((result: ParseResult) => void) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly disposables: Monaco.IDisposable[] = [];
  private sessionIdValue: string;
  private languageIdValue: string;
  private documentVersionValue: number;
  private stateValue: MonacoSyntaxBindingState = "opening";
  private parseTimeMsValue: number | undefined;
  private hasErrorsValue: boolean | undefined;
  private disposed = false;

  constructor(options: MonacoSyntaxDocumentBindingOptions) {
    this.model = options.model;
    this.client = options.client;
    this.documentUri = this.model.uri.toString();
    this.createSessionId = options.createSessionId ?? defaultSessionId;
    this.onStateChange = options.onStateChange;
    this.onParseResult = options.onParseResult;
    this.onError = options.onError;
    this.sessionIdValue = this.createSessionId(this.documentUri);
    this.languageIdValue = this.model.getLanguageId();
    this.documentVersionValue = this.model.getVersionId();

    this.disposables.push(
      this.model.onDidChangeContent((event) => this.handleContentChange(event)),
      this.model.onDidChangeLanguage(() => this.handleLanguageChange()),
      this.model.onWillDispose(() => this.dispose()),
    );
    this.publishState();
    this.openCurrentSession();
  }

  get snapshot(): MonacoSyntaxBindingSnapshot {
    return {
      state: this.stateValue,
      documentUri: this.documentUri,
      sessionId: this.sessionIdValue,
      languageId: this.languageIdValue,
      documentVersion: this.documentVersionValue,
      parseTimeMs: this.parseTimeMsValue,
      hasErrors: this.hasErrorsValue,
    };
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get state(): MonacoSyntaxBindingState {
    return this.stateValue;
  }

  get openDocumentSnapshot(): MonacoSyntaxOpenDocumentSnapshot {
    return {
      type: "OpenDocument",
      sessionId: this.sessionIdValue,
      documentUri: this.documentUri,
      documentVersion: this.model.getVersionId(),
      languageId: this.model.getLanguageId(),
      text: this.model.getValue(),
    };
  }

  restore(): Promise<ParseResult> {
    if (this.disposed) {
      return Promise.reject(new Error("Cannot restore a disposed Monaco model binding."));
    }

    this.documentVersionValue = this.model.getVersionId();
    this.languageIdValue = this.model.getLanguageId();
    this.parseTimeMsValue = undefined;
    this.hasErrorsValue = undefined;
    this.stateValue = "opening";
    this.publishState();

    const sessionId = this.sessionIdValue;
    return this.sendParseRequest(this.createOpenRequest(), sessionId, "open").then((response) => {
      if (response.type !== "ParseResult") {
        throw new Error(`Unexpected ${response.type} response while restoring a Monaco model.`);
      }
      return response;
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.sendClose(this.sessionIdValue, this.documentVersionValue);
    this.stateValue = "closed";
    this.publishState();
  }

  private openCurrentSession(): void {
    const sessionId = this.sessionIdValue;
    void this.sendParseRequest(this.createOpenRequest(), sessionId, "open").catch(() => undefined);
  }

  private createOpenRequest(): MonacoSyntaxOpenDocumentSnapshot {
    return {
      type: "OpenDocument",
      sessionId: this.sessionIdValue,
      documentUri: this.documentUri,
      documentVersion: this.documentVersionValue,
      languageId: this.languageIdValue,
      text: this.model.getValue(),
    };
  }

  private handleContentChange(event: Monaco.editor.IModelContentChangedEvent): void {
    if (this.disposed) {
      return;
    }

    const sessionId = this.sessionIdValue;
    const baseVersion = this.documentVersionValue;
    this.documentVersionValue = event.versionId;

    if (event.isFlush || event.isEolChange) {
      this.sendCurrentSnapshot(sessionId, "replace");
      return;
    }

    void this.sendParseRequest(
      {
        type: "ApplyChanges",
        sessionId,
        documentUri: this.documentUri,
        baseVersion,
        nextVersion: event.versionId,
        changes: event.changes.map(({ rangeOffset, rangeLength, text }) => ({
          rangeOffset,
          rangeLength,
          text,
        })),
      },
      sessionId,
      "incremental",
    ).catch(() => undefined);
  }

  private handleLanguageChange(): void {
    if (this.disposed) {
      return;
    }

    const oldSessionId = this.sessionIdValue;
    this.sendClose(oldSessionId, this.documentVersionValue);

    this.sessionIdValue = this.createSessionId(this.documentUri);
    this.languageIdValue = this.model.getLanguageId();
    this.documentVersionValue = this.model.getVersionId();
    this.parseTimeMsValue = undefined;
    this.hasErrorsValue = undefined;
    this.stateValue = "opening";
    this.publishState();
    this.openCurrentSession();
  }

  private sendCurrentSnapshot(sessionId: string, requestKind: "replace" | "resync"): void {
    this.documentVersionValue = this.model.getVersionId();
    void this.sendParseRequest(
      {
        type: "ReplaceDocument",
        sessionId,
        documentUri: this.documentUri,
        documentVersion: this.documentVersionValue,
        text: this.model.getValue(),
      },
      sessionId,
      requestKind,
    ).catch(() => undefined);
  }

  private sendParseRequest(
    request: TreeSitterClientRequest,
    sessionId: string,
    requestKind: "open" | "incremental" | "replace" | "resync",
  ): Promise<WorkerResponse> {
    let responsePromise: Promise<WorkerResponse>;
    try {
      responsePromise = this.client.request(request);
    } catch (error: unknown) {
      this.handleRequestError(error, sessionId, requestKind);
      return Promise.reject(error);
    }

    return responsePromise
      .then((response) => {
        this.handleResponse(response, sessionId);
        return response;
      })
      .catch((error: unknown) => {
        this.handleRequestError(error, sessionId, requestKind);
        throw error;
      });
  }

  private handleResponse(response: WorkerResponse, sessionId: string): void {
    if (
      this.disposed ||
      sessionId !== this.sessionIdValue ||
      response.type !== "ParseResult" ||
      response.sessionId !== sessionId ||
      response.documentVersion !== this.documentVersionValue
    ) {
      return;
    }

    this.parseTimeMsValue = response.parseTimeMs;
    this.hasErrorsValue = response.hasErrors;
    this.stateValue = "ready";
    this.publishState();
    this.onParseResult?.(response);
  }

  private handleRequestError(
    error: unknown,
    sessionId: string,
    requestKind: "open" | "incremental" | "replace" | "resync",
  ): void {
    if (this.disposed || sessionId !== this.sessionIdValue) {
      return;
    }

    this.onError?.(error);
    if (requestKind === "incremental" && shouldFullResync(error)) {
      this.stateValue = "desynced";
      this.publishState();
      this.sendCurrentSnapshot(sessionId, "resync");
      return;
    }

    this.stateValue = "error";
    this.publishState();
  }

  private sendClose(sessionId: string, documentVersion: number): void {
    try {
      this.client.send({
        type: "CloseDocument",
        sessionId,
        documentUri: this.documentUri,
        documentVersion,
      });
    } catch (error: unknown) {
      this.onError?.(error);
    }
  }

  private publishState(): void {
    this.onStateChange?.(this.snapshot);
  }
}

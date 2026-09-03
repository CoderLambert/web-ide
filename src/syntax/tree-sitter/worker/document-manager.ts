import type { Tree } from "web-tree-sitter";

import type { ApplyChanges, ParseResult, ReplaceDocument, TextRange } from "../protocol";
import { encodeEditTransaction, EditCodecError } from "../edit-codec";
import type { OpenDocumentInput, DocumentSession } from "./document-session";
import { WorkerRuntime } from "./runtime";
import { treeSitterRangeToTextRange } from "./text-range";

export type DocumentManagerErrorCode =
  | "INVALID_DOCUMENT"
  | "UNKNOWN_LANGUAGE"
  | "DOCUMENT_ALREADY_OPEN"
  | "SESSION_ALREADY_OPEN"
  | "SESSION_NOT_FOUND"
  | "VERSION_MISMATCH"
  | "PARSE_FAILED"
  | "RESYNC_REQUIRED";

export class DocumentManagerError extends Error {
  readonly code: DocumentManagerErrorCode;

  constructor(code: DocumentManagerErrorCode, message: string) {
    super(message);
    this.name = "DocumentManagerError";
    this.code = code;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DocumentManager {
  private readonly sessionsById = new Map<string, DocumentSession>();
  private readonly sessionIdByUri = new Map<string, string>();

  constructor(private readonly runtime: WorkerRuntime) {}

  async openDocument(input: OpenDocumentInput): Promise<DocumentSession> {
    this.validateInput(input);
    this.assertAvailable(input);

    const definition = this.runtime.getLanguageDefinition(input.languageId);
    if (definition === undefined) {
      throw new DocumentManagerError("UNKNOWN_LANGUAGE", `Unknown language "${input.languageId}".`);
    }

    const languageRuntime = await this.runtime.loadLanguage(definition);
    const parser = await languageRuntime.getParser();
    let tree: Tree | null;
    try {
      tree = parser.parse(input.text);
    } catch (error: unknown) {
      throw new DocumentManagerError(
        "PARSE_FAILED",
        `Failed to parse document "${input.documentUri}": ${errorMessage(error)}`,
      );
    }

    if (tree === null) {
      throw new DocumentManagerError(
        "PARSE_FAILED",
        `Failed to parse document "${input.documentUri}": parser returned no tree.`,
      );
    }

    try {
      this.assertAvailable(input);
    } catch (error: unknown) {
      tree.delete();
      throw error;
    }

    const session: DocumentSession = {
      documentUri: input.documentUri,
      sessionId: input.sessionId,
      documentVersion: input.documentVersion,
      languageId: input.languageId,
      textMirror: input.text,
      tree,
      state: "ready",
    };

    this.sessionsById.set(session.sessionId, session);
    this.sessionIdByUri.set(session.documentUri, session.sessionId);
    return session;
  }

  async applyChanges(request: ApplyChanges): Promise<ParseResult> {
    const session = this.sessionsById.get(request.sessionId);
    if (session === undefined || session.documentUri !== request.documentUri) {
      throw new DocumentManagerError(
        "SESSION_NOT_FOUND",
        `Session "${request.sessionId}" does not own document "${request.documentUri}".`,
      );
    }
    if (session.state === "desynced") {
      throw new DocumentManagerError(
        "RESYNC_REQUIRED",
        `Session "${request.sessionId}" requires a full document resync.`,
      );
    }
    if (session.documentVersion !== request.baseVersion) {
      throw new DocumentManagerError(
        "RESYNC_REQUIRED",
        `Document version ${session.documentVersion} does not match baseVersion ${request.baseVersion}.`,
      );
    }

    let transaction;
    try {
      transaction = encodeEditTransaction(session.textMirror, request.changes);
    } catch (error: unknown) {
      const message =
        error instanceof EditCodecError
          ? error.message
          : `Invalid edit transaction: ${errorMessage(error)}`;
      throw new DocumentManagerError("RESYNC_REQUIRED", message);
    }

    const languageRuntime = await this.runtime.loadLanguage(session.languageId);
    const parser = await languageRuntime.getParser();
    if (
      this.sessionsById.get(request.sessionId) !== session ||
      session.documentVersion !== request.baseVersion
    ) {
      throw new DocumentManagerError(
        "RESYNC_REQUIRED",
        `Session "${request.sessionId}" changed while applying edits.`,
      );
    }

    const oldTree = session.tree;
    let newTree: Tree | null = null;
    let treeWasEdited = transaction.inputEdits.length > 0;
    try {
      for (const inputEdit of transaction.inputEdits) {
        treeWasEdited = true;
        oldTree.edit(inputEdit);
      }

      const parseStartedAt = globalThis.performance.now();
      newTree = parser.parse(transaction.stagedText, oldTree);
      const parseTimeMs = globalThis.performance.now() - parseStartedAt;
      if (newTree === null) {
        throw new Error("parser returned no tree");
      }

      const changedRanges = oldTree
        .getChangedRanges(newTree)
        .map((range) => treeSitterRangeToTextRange(transaction.stagedText, range));
      const hasErrors = newTree.rootNode.hasError;

      oldTree.delete();
      session.tree = newTree;
      newTree = null;
      session.textMirror = transaction.stagedText;
      session.documentVersion = request.nextVersion;
      session.state = "ready";

      return {
        type: "ParseResult",
        protocolVersion: request.protocolVersion,
        workerGeneration: request.workerGeneration,
        requestId: request.requestId,
        sessionId: session.sessionId,
        documentUri: session.documentUri,
        documentVersion: session.documentVersion,
        parseTimeMs,
        hasErrors,
        changedRanges,
      };
    } catch (error: unknown) {
      if (newTree !== null) {
        safelyDelete(newTree);
      }
      if (treeWasEdited) {
        safelyDelete(oldTree);
        session.state = "desynced";
        throw new DocumentManagerError(
          "RESYNC_REQUIRED",
          `Incremental parse failed for "${session.documentUri}": ${errorMessage(error)}`,
        );
      }

      throw new DocumentManagerError(
        "PARSE_FAILED",
        `Incremental parse failed for "${session.documentUri}": ${errorMessage(error)}`,
      );
    }
  }

  async replaceDocument(request: ReplaceDocument): Promise<ParseResult> {
    const session = this.sessionsById.get(request.sessionId);
    if (session === undefined || session.documentUri !== request.documentUri) {
      throw new DocumentManagerError(
        "SESSION_NOT_FOUND",
        `Session "${request.sessionId}" does not own document "${request.documentUri}".`,
      );
    }
    if (request.documentVersion < session.documentVersion) {
      throw new DocumentManagerError(
        "VERSION_MISMATCH",
        `Document version ${request.documentVersion} is older than session version ${session.documentVersion}.`,
      );
    }

    const languageRuntime = await this.runtime.loadLanguage(session.languageId);
    const parser = await languageRuntime.getParser();
    if (
      this.sessionsById.get(request.sessionId) !== session ||
      request.documentVersion < session.documentVersion
    ) {
      throw new DocumentManagerError(
        "VERSION_MISMATCH",
        `Session "${request.sessionId}" changed before full resync completed.`,
      );
    }

    const parseStartedAt = globalThis.performance.now();
    let newTree: Tree | null = null;
    try {
      newTree = parser.parse(request.text);
      const parseTimeMs = globalThis.performance.now() - parseStartedAt;
      if (newTree === null) {
        throw new Error("parser returned no tree");
      }
      const hasErrors = newTree.rootNode.hasError;

      if (session.state === "ready") {
        session.tree.delete();
      }
      session.tree = newTree;
      newTree = null;
      session.textMirror = request.text;
      session.documentVersion = request.documentVersion;
      session.state = "ready";

      return {
        type: "ParseResult",
        protocolVersion: request.protocolVersion,
        workerGeneration: request.workerGeneration,
        requestId: request.requestId,
        sessionId: session.sessionId,
        documentUri: session.documentUri,
        documentVersion: session.documentVersion,
        parseTimeMs,
        hasErrors,
        changedRanges: [fullTextRange(request.text)],
      };
    } catch (error: unknown) {
      if (newTree !== null) {
        safelyDelete(newTree);
      }
      throw new DocumentManagerError(
        "PARSE_FAILED",
        `Full parse failed for "${session.documentUri}": ${errorMessage(error)}`,
      );
    }
  }

  getSession(sessionId: string): DocumentSession | undefined {
    return this.sessionsById.get(sessionId);
  }

  getSessionForUri(documentUri: string): DocumentSession | undefined {
    const sessionId = this.sessionIdByUri.get(documentUri);
    return sessionId === undefined ? undefined : this.sessionsById.get(sessionId);
  }

  getSessionCount(): number {
    return this.sessionsById.size;
  }

  closeDocument(sessionId: string): boolean {
    const session = this.sessionsById.get(sessionId);
    if (session === undefined) {
      return false;
    }

    try {
      session.tree.delete();
    } finally {
      this.sessionsById.delete(sessionId);
      if (this.sessionIdByUri.get(session.documentUri) === sessionId) {
        this.sessionIdByUri.delete(session.documentUri);
      }
    }

    return true;
  }

  dispose(): void {
    for (const sessionId of this.sessionsById.keys()) {
      this.closeDocument(sessionId);
    }
  }

  private validateInput(input: OpenDocumentInput): void {
    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.documentUri !== "string" ||
      input.documentUri.length === 0 ||
      typeof input.sessionId !== "string" ||
      input.sessionId.length === 0 ||
      !Number.isInteger(input.documentVersion) ||
      input.documentVersion < 0 ||
      typeof input.languageId !== "string" ||
      input.languageId.length === 0 ||
      typeof input.text !== "string"
    ) {
      throw new DocumentManagerError(
        "INVALID_DOCUMENT",
        "OpenDocument input contains an invalid field.",
      );
    }
  }

  private assertAvailable(input: OpenDocumentInput): void {
    if (this.sessionIdByUri.has(input.documentUri)) {
      throw new DocumentManagerError(
        "DOCUMENT_ALREADY_OPEN",
        `Document "${input.documentUri}" is already open.`,
      );
    }
    if (this.sessionsById.has(input.sessionId)) {
      throw new DocumentManagerError(
        "SESSION_ALREADY_OPEN",
        `Session "${input.sessionId}" is already open.`,
      );
    }
  }
}

function fullTextRange(text: string): TextRange {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      line += 1;
      lineStart = index + 1;
    }
  }

  return {
    start: { line: 0, character: 0 },
    end: { line, character: text.length - lineStart },
  };
}

function safelyDelete(tree: Tree): void {
  try {
    tree.delete();
  } catch {
    // The tree is already invalid after an incremental failure; preserve RESYNC_REQUIRED.
  }
}

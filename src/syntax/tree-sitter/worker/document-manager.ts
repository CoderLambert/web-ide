import type { Tree } from "web-tree-sitter";

import type { OpenDocumentInput, DocumentSession } from "./document-session";
import { WorkerRuntime } from "./runtime";

export type DocumentManagerErrorCode =
  | "INVALID_DOCUMENT"
  | "UNKNOWN_LANGUAGE"
  | "DOCUMENT_ALREADY_OPEN"
  | "SESSION_ALREADY_OPEN"
  | "PARSE_FAILED";

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

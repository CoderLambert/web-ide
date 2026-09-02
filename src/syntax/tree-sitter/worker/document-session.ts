import type { Tree } from "web-tree-sitter";

export type DocumentSessionState = "ready" | "desynced";

export interface DocumentSession {
  /** Opaque identity supplied by the document binding. */
  documentUri: string;
  /** Identifies one binding lifetime, including close/reopen boundaries. */
  sessionId: string;
  documentVersion: number;
  languageId: string;
  textMirror: string;
  tree: Tree;
  state: DocumentSessionState;
}

export interface OpenDocumentInput {
  documentUri: string;
  sessionId: string;
  documentVersion: number;
  languageId: string;
  text: string;
}

import type { WorkspacePath } from "./path";

export interface WorkspaceEntry {
  path: WorkspacePath;
  kind: "file" | "directory";
}

/**
 * A UTF-8 text filesystem capability bound to one active workspace.
 *
 * Implementations must apply the shared WorkspacePath contract. The empty root
 * path is accepted only by list(). All entries returned by list() use their
 * complete WorkspacePath, even when listing a nested directory.
 */
export interface WorkspaceFileSystem {
  list(path: WorkspacePath): Promise<WorkspaceEntry[]>;
  readFile(path: WorkspacePath): Promise<string>;
  writeFile(path: WorkspacePath, content: string): Promise<void>;
  createFile(path: WorkspacePath): Promise<void>;
  createDirectory(path: WorkspacePath): Promise<void>;
  rename(from: WorkspacePath, to: WorkspacePath): Promise<void>;
  delete(path: WorkspacePath): Promise<void>;
}

export const WORKSPACE_FILE_SYSTEM_ERROR_CODES = [
  "INVALID_PATH",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "NOT_FILE",
  "NOT_DIRECTORY",
  "DIRECTORY_NOT_EMPTY",
  "FORBIDDEN",
  "UNSUPPORTED",
  "IO_ERROR",
] as const;

export type WorkspaceFileSystemErrorCode = (typeof WORKSPACE_FILE_SYSTEM_ERROR_CODES)[number];

/** Project-level filesystem failure; adapters must not expose transport or host errors. */
export class WorkspaceFileSystemError extends Error {
  readonly code: WorkspaceFileSystemErrorCode;

  constructor(code: WorkspaceFileSystemErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceFileSystemError";
    this.code = code;
  }
}

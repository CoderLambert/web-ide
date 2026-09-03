import type { WorkspaceEntry, WorkspaceFileSystemErrorCode } from "./file-system";
import type { WorkspacePath } from "./path";

interface WorkspaceApiRequestBase {
  workspaceId: string;
}

export type WorkspaceApiRequest =
  | (WorkspaceApiRequestBase & { operation: "list"; path: WorkspacePath })
  | (WorkspaceApiRequestBase & { operation: "readFile"; path: WorkspacePath })
  | (WorkspaceApiRequestBase & {
      operation: "writeFile";
      path: WorkspacePath;
      content: string;
    })
  | (WorkspaceApiRequestBase & { operation: "createFile"; path: WorkspacePath })
  | (WorkspaceApiRequestBase & { operation: "createDirectory"; path: WorkspacePath })
  | (WorkspaceApiRequestBase & {
      operation: "rename";
      from: WorkspacePath;
      to: WorkspacePath;
    })
  | (WorkspaceApiRequestBase & { operation: "delete"; path: WorkspacePath });

export type WorkspaceApiResult = WorkspaceEntry[] | string | null;

export interface WorkspaceApiSuccess {
  ok: true;
  result: WorkspaceApiResult;
}

export interface WorkspaceApiFailure {
  ok: false;
  error: {
    code: WorkspaceFileSystemErrorCode;
    message: string;
  };
}

export type WorkspaceApiResponse = WorkspaceApiSuccess | WorkspaceApiFailure;

export function workspaceErrorMessage(code: WorkspaceFileSystemErrorCode): string {
  switch (code) {
    case "INVALID_PATH":
      return "Invalid workspace path.";
    case "NOT_FOUND":
      return "Workspace entry was not found.";
    case "ALREADY_EXISTS":
      return "Workspace entry already exists.";
    case "NOT_FILE":
      return "Workspace path is not a file.";
    case "NOT_DIRECTORY":
      return "Workspace path is not a directory.";
    case "DIRECTORY_NOT_EMPTY":
      return "Workspace directory is not empty.";
    case "FORBIDDEN":
      return "Workspace access denied.";
    case "UNSUPPORTED":
      return "Unsupported workspace request.";
    case "IO_ERROR":
      return "Workspace operation failed.";
  }
}

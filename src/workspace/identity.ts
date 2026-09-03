import type { WorkspacePath } from "./path";

export const WORKSPACE_ROOT_URI = "file:///workspace";

export interface WorkspaceIdentity {
  id: string;
  rootUri: string;
}

export interface WorkspaceFile {
  path: WorkspacePath;
  languageId?: string;
}

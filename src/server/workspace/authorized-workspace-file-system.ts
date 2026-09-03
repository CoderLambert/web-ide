import { BackendWorkspaceFileSystem } from "./backend-workspace-file-system";
import type { WorkspaceFileSystem } from "../../workspace/file-system";

export interface WorkspaceAuthorizer {
  authorize(workspaceId: string): Promise<void>;
}

export interface WorkspaceRootResolver {
  resolveRoot(workspaceId: string): Promise<string>;
}

/** Ensures authorization completes before a server-owned host root is resolved. */
export async function createAuthorizedWorkspaceFileSystem(
  workspaceId: string,
  authorizer: WorkspaceAuthorizer,
  rootResolver: WorkspaceRootResolver,
): Promise<WorkspaceFileSystem> {
  await authorizer.authorize(workspaceId);
  const boundRoot = await rootResolver.resolveRoot(workspaceId);
  return new BackendWorkspaceFileSystem(boundRoot);
}

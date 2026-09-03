import { WORKSPACE_ROOT_URI } from "./identity";
import { validateWorkspacePath, type WorkspacePath } from "./path";

const WORKSPACE_URI_PREFIX = `${WORKSPACE_ROOT_URI}/`;

export interface WorkspaceUriMapper {
  toUri(path: WorkspacePath): string;
  fromUri(uri: string): WorkspacePath;
}

export const workspaceUriMapper: WorkspaceUriMapper = {
  toUri: toWorkspaceUri,
  fromUri: fromWorkspaceUri,
};

export function toWorkspaceUri(path: WorkspacePath): string {
  validateWorkspacePath(path, { allowRoot: true });

  if (path === "") {
    return WORKSPACE_ROOT_URI;
  }

  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${WORKSPACE_URI_PREFIX}${encodedPath}`;
}

export function fromWorkspaceUri(uri: string): WorkspacePath {
  if (uri === WORKSPACE_ROOT_URI) {
    return "";
  }

  if (!uri.startsWith(WORKSPACE_URI_PREFIX)) {
    throw new Error("Workspace URI is outside the canonical workspace namespace.");
  }

  const encodedPath = uri.slice(WORKSPACE_URI_PREFIX.length);
  let path: string;

  try {
    path = encodedPath.split("/").map(decodeURIComponent).join("/");
  } catch {
    throw new Error("Workspace URI contains invalid percent encoding.");
  }

  validateWorkspacePath(path);

  if (toWorkspaceUri(path) !== uri) {
    throw new Error("Workspace URI must use canonical encoding.");
  }

  return path;
}

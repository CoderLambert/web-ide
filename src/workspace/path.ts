export type WorkspacePath = string;

export interface WorkspacePathValidationOptions {
  allowRoot?: boolean;
}

export function validateWorkspacePath(
  path: string,
  { allowRoot = false }: WorkspacePathValidationOptions = {},
): WorkspacePath {
  if (path === "") {
    if (allowRoot) {
      return path;
    }

    throw new Error("Workspace root path is not allowed here.");
  }

  if (path.startsWith("/")) {
    throw new Error("WorkspacePath must be relative to the workspace root.");
  }

  if (path.endsWith("/")) {
    throw new Error("WorkspacePath must not end with '/'.");
  }

  if (path.includes("\\")) {
    throw new Error("WorkspacePath must use '/' as its separator.");
  }

  if (path.includes("\0")) {
    throw new Error("WorkspacePath must not contain NUL.");
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment === "")) {
    throw new Error("WorkspacePath must not contain empty segments.");
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("WorkspacePath must not contain '.' or '..' segments.");
  }

  return path;
}

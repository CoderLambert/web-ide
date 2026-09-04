import { WorkspaceFileSystemError } from "../../workspace/file-system";
import { isConfiguredValue } from "../configuration";
import { handleWorkspaceApiRequest } from "./api";

export interface ServerWorkspaceConfiguration {
  workspaceId?: string;
  root?: string;
  token?: string;
}

export function handleConfiguredWorkspaceApiRequest(request: Request): Promise<Response> {
  return handleWorkspaceApiRequestWithConfiguration(request, {
    workspaceId: process.env.WEB_IDE_WORKSPACE_ID,
    root: process.env.WEB_IDE_WORKSPACE_ROOT,
    token: process.env.WEB_IDE_WORKSPACE_TOKEN,
  });
}

export function handleWorkspaceApiRequestWithConfiguration(
  request: Request,
  configuration: ServerWorkspaceConfiguration,
): Promise<Response> {
  const workspaceToken = readCookie(request.headers.get("cookie"), "web_ide_workspace_token");
  return handleWorkspaceApiRequest(request, {
    authorizer: {
      async authorize(workspaceId) {
        if (
          !isConfiguredValue(configuration.workspaceId) ||
          workspaceId !== configuration.workspaceId ||
          !isConfiguredValue(configuration.token) ||
          workspaceToken !== configuration.token
        ) {
          throw new WorkspaceFileSystemError("FORBIDDEN", "Workspace access denied.");
        }
      },
    },
    rootResolver: {
      async resolveRoot() {
        if (!isConfiguredValue(configuration.root)) {
          throw new WorkspaceFileSystemError("IO_ERROR", "Workspace is unavailable.");
        }
        return configuration.root;
      },
    },
  });
}

function readCookie(header: string | null, name: string): string | undefined {
  if (header === null) {
    return undefined;
  }
  for (const cookie of header.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator !== -1 && cookie.slice(0, separator).trim() === name) {
      return cookie.slice(separator + 1).trim();
    }
  }
  return undefined;
}

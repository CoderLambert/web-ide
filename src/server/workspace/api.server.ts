import { WorkspaceFileSystemError } from "../../workspace/file-system";
import { isConfiguredValue } from "../configuration";
import { handleWorkspaceApiRequest } from "./api";
import { readCookie, resolveWorkspaceSessionCookieName } from "./session-cookie";

export interface ServerWorkspaceConfiguration {
  workspaceId?: string;
  root?: string;
  token?: string;
  enabled?: string;
}

export function handleConfiguredWorkspaceApiRequest(request: Request): Promise<Response> {
  return handleWorkspaceApiRequestWithConfiguration(request, {
    workspaceId: process.env.WEB_IDE_WORKSPACE_ID,
    root: process.env.WEB_IDE_WORKSPACE_ROOT,
    token: process.env.WEB_IDE_WORKSPACE_TOKEN,
    enabled: process.env.WEB_IDE_LOCAL_SESSION_BOOTSTRAP,
  });
}

export function handleWorkspaceApiRequestWithConfiguration(
  request: Request,
  configuration: ServerWorkspaceConfiguration,
): Promise<Response> {
  const workspaceToken = readCookie(
    request.headers.get("cookie"),
    resolveWorkspaceSessionCookieName({
      enabled: configuration.enabled,
      host: request.headers.get("host") ?? undefined,
    }),
  );
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

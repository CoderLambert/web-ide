import { isConfiguredValue } from "../configuration";
import { readCookie, resolveWorkspaceSessionCookieName } from "./session-cookie";

export interface WorkspaceSessionConfiguration {
  workspaceId?: string;
  token?: string;
  enabled?: string;
}

const WORKSPACE_ID_HEADER = "X-Web-Ide-Workspace-Id";

export function handleConfiguredWorkspaceSessionRequest(request: Request): Response {
  return handleWorkspaceSessionRequestWithConfiguration(request, {
    workspaceId: process.env.WEB_IDE_WORKSPACE_ID,
    token: process.env.WEB_IDE_WORKSPACE_TOKEN,
    enabled: process.env.WEB_IDE_LOCAL_SESSION_BOOTSTRAP,
  });
}

export function handleWorkspaceSessionRequestWithConfiguration(
  request: Request,
  configuration: WorkspaceSessionConfiguration,
): Response {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" },
    });
  }

  if (
    isConfiguredValue(configuration.workspaceId) &&
    isConfiguredValue(configuration.token) &&
    readCookie(
      request.headers.get("cookie"),
      resolveWorkspaceSessionCookieName({
        enabled: configuration.enabled,
        host: request.headers.get("host") ?? undefined,
      }),
    ) === configuration.token
  ) {
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
        [WORKSPACE_ID_HEADER]: configuration.workspaceId,
      },
    });
  }

  return forbiddenResponse();
}

function forbiddenResponse(): Response {
  return Response.json(
    { ok: false, error: { code: "FORBIDDEN", message: "Workspace access denied." } },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}

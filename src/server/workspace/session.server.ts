import { isConfiguredValue } from "../configuration";

export interface WorkspaceSessionConfiguration {
  workspaceId?: string;
  token?: string;
}

const WORKSPACE_ID_HEADER = "X-Web-Ide-Workspace-Id";

export function handleConfiguredWorkspaceSessionRequest(request: Request): Response {
  return handleWorkspaceSessionRequestWithConfiguration(request, {
    workspaceId: process.env.WEB_IDE_WORKSPACE_ID,
    token: process.env.WEB_IDE_WORKSPACE_TOKEN,
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
    readCookie(request.headers.get("cookie"), "web_ide_workspace_token") === configuration.token
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

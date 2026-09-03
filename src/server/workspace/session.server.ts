export interface WorkspaceSessionConfiguration {
  workspaceId?: string;
  token?: string;
  localSessionBootstrap?: string;
}

export function handleConfiguredWorkspaceSessionRequest(request: Request): Response {
  return handleWorkspaceSessionRequestWithConfiguration(request, {
    workspaceId: process.env.WEB_IDE_WORKSPACE_ID,
    token: process.env.WEB_IDE_WORKSPACE_TOKEN,
    localSessionBootstrap: process.env.WEB_IDE_LOCAL_SESSION_BOOTSTRAP,
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

  const requestUrl = new URL(request.url);
  if (
    configuration.localSessionBootstrap !== "1" ||
    !isConfigured(configuration.workspaceId) ||
    !isConfigured(configuration.token) ||
    !isLocalHost(requestUrl.hostname)
  ) {
    return forbiddenResponse();
  }

  const cookie = [
    `web_ide_workspace_token=${configuration.token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (requestUrl.protocol === "https:") {
    cookie.push("Secure");
  }

  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "set-cookie": cookie.join("; "),
    },
  });
}

function forbiddenResponse(): Response {
  return Response.json(
    { ok: false, error: { code: "FORBIDDEN", message: "Workspace access denied." } },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}

function isConfigured(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

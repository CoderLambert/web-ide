import type { Connect } from "vite";

import { isConfiguredValue } from "../configuration";

export interface LocalWorkspaceSessionConfiguration {
  workspaceId?: string;
  token?: string;
  enabled?: string;
}

export function createLocalWorkspaceSessionBootstrapMiddleware(
  configuration: LocalWorkspaceSessionConfiguration,
): Connect.NextHandleFunction {
  return (request, response, next) => {
    const path = request.url?.split("?", 1)[0];

    if (
      path !== "/api/workspace/session" ||
      request.method !== "POST" ||
      configuration.enabled !== "1"
    ) {
      next();
      return;
    }

    if (!isConfiguredValue(configuration.workspaceId) || !isConfiguredValue(configuration.token)) {
      next();
      return;
    }

    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      next();
      return;
    }

    if (!isLocalHost(request.headers.host)) {
      next();
      return;
    }

    response.statusCode = 204;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Set-Cookie",
      [
        `web_ide_workspace_token=${configuration.token}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
      ].join("; "),
    );
    response.end();
  };
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isLocalHost(host: string | undefined): boolean {
  if (host === undefined) {
    return false;
  }

  const normalized = host.toLowerCase();

  return (
    normalized === "localhost" ||
    normalized.startsWith("localhost:") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.0.0.1:") ||
    normalized === "[::1]" ||
    normalized.startsWith("[::1]:")
  );
}

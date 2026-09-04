import type { Connect } from "vite";

import { isConfiguredValue } from "../configuration";

export interface LocalWorkspaceSessionConfiguration {
  workspaceId?: string;
  token?: string;
  enabled?: string;
}

const WORKSPACE_ID_HEADER = "X-Web-Ide-Workspace-Id";

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

    if (!hasAllowedOrigin(request.headers.origin, request.headers.host)) {
      next();
      return;
    }

    if (readCookie(request.headers.cookie, "web_ide_workspace_token") === configuration.token) {
      next();
      return;
    }

    response.statusCode = 204;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(WORKSPACE_ID_HEADER, configuration.workspaceId);
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

function hasAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) {
    return true;
  }

  if (host === undefined || origin === "null") {
    return false;
  }

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) {
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

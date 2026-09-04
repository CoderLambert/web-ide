import type { Connect } from "vite";

import { isConfiguredValue } from "../configuration";
import { isLocalHost, readCookie, resolveWorkspaceSessionCookieName } from "./session-cookie";

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

    const host = request.headers.host;
    if (!isLocalHost(host)) {
      next();
      return;
    }

    if (!hasAllowedOrigin(request.headers.origin, request.headers.host)) {
      next();
      return;
    }

    const cookieName = resolveWorkspaceSessionCookieName({
      enabled: configuration.enabled,
      host,
    });
    if (readCookie(request.headers.cookie, cookieName) === configuration.token) {
      next();
      return;
    }

    response.statusCode = 204;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(WORKSPACE_ID_HEADER, configuration.workspaceId);
    response.setHeader(
      "Set-Cookie",
      [`${cookieName}=${configuration.token}`, "Path=/", "HttpOnly", "SameSite=Strict"].join("; "),
    );
    response.end();
  };
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
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

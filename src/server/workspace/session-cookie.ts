import { createHash } from "node:crypto";

export const WORKSPACE_SESSION_COOKIE_NAME = "web_ide_workspace_token";

export interface WorkspaceSessionCookieOptions {
  enabled?: string;
  host?: string;
}

export function resolveWorkspaceSessionCookieName(
  options: WorkspaceSessionCookieOptions = {},
): string {
  if (options.enabled !== "1" || !isLocalHost(options.host)) {
    return WORKSPACE_SESSION_COOKIE_NAME;
  }

  const normalizedHost = options.host!.toLowerCase();
  const hostHash = createHash("sha256").update(normalizedHost).digest("hex").slice(0, 16);
  return `${WORKSPACE_SESSION_COOKIE_NAME}_${hostHash}`;
}

export function isLocalHost(host: string | undefined): boolean {
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

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (header === null || header === undefined) {
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

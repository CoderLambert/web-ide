import { handleSqlLabApiRequest } from "@/server/sql-lab/api";
import { SqlLabService } from "@/server/sql-lab/service";

export interface ServerSqlLabConfiguration {
  workspaceId?: string;
  token?: string;
  databasePath?: string;
}

const configuredHandler = createSqlLabApiHandler({
  workspaceId: process.env.WEB_IDE_WORKSPACE_ID,
  token: process.env.WEB_IDE_WORKSPACE_TOKEN,
  databasePath: process.env.WEB_IDE_SQL_LAB_DATABASE_PATH,
});

export function handleConfiguredSqlLabApiRequest(request: Request): Promise<Response> {
  return configuredHandler(request);
}

export function createSqlLabApiHandler(
  configuration: ServerSqlLabConfiguration,
): (request: Request) => Promise<Response> {
  const service = new SqlLabService({ databasePath: configuration.databasePath ?? "" });
  return (request) =>
    handleSqlLabApiRequest(request, {
      service,
      authorize(workspaceId) {
        const token = readCookie(request.headers.get("cookie"), "web_ide_workspace_token");
        if (
          configuration.workspaceId === undefined ||
          configuration.token === undefined ||
          workspaceId !== configuration.workspaceId ||
          token !== configuration.token
        ) {
          throw new SqlLabApiAuthorizationError();
        }
      },
    });
}

class SqlLabApiAuthorizationError extends Error {
  readonly code = "FORBIDDEN" as const;

  constructor() {
    super("SQL Lab access denied.");
  }
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

import { handleSqlLabApiRequest } from "@/server/sql-lab/api";
import { assertDatabasePathOutsideWorkspace } from "@/server/sql-lab/database-path";
import { SqlLabService } from "@/server/sql-lab/service";

export interface ServerSqlLabConfiguration {
  workspaceId?: string;
  workspaceRoot?: string;
  token?: string;
  databasePath?: string;
}

const configuredHandler = createSqlLabApiHandler({
  workspaceId: process.env.WEB_IDE_WORKSPACE_ID,
  workspaceRoot: process.env.WEB_IDE_WORKSPACE_ROOT,
  token: process.env.WEB_IDE_WORKSPACE_TOKEN,
  databasePath: process.env.WEB_IDE_SQL_LAB_DATABASE_PATH,
});

export function handleConfiguredSqlLabApiRequest(request: Request): Promise<Response> {
  return configuredHandler(request);
}

export function createSqlLabApiHandler(
  configuration: ServerSqlLabConfiguration,
): (request: Request) => Promise<Response> {
  const databasePath = configuration.databasePath ?? "";
  if (databasePath !== "" && configuration.workspaceRoot !== undefined) {
    assertDatabasePathOutsideWorkspace(databasePath, configuration.workspaceRoot);
  }
  const service = new SqlLabService({ databasePath });
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

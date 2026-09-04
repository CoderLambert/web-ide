import { handleSqlLabApiRequest } from "@/server/sql-lab/api";
import { assertDatabasePathOutsideWorkspace } from "@/server/sql-lab/database-path";
import { SqlLabService } from "@/server/sql-lab/service";
import type { SqlLabResponse } from "@/sql-lab/contract";
import { isConfiguredValue } from "../configuration";

export interface ServerSqlLabConfiguration {
  workspaceId?: string;
  workspaceRoot?: string;
  token?: string;
  databasePath?: string;
}

let configuredHandler: ((request: Request) => Promise<Response>) | undefined;

export function handleConfiguredSqlLabApiRequest(request: Request): Promise<Response> {
  configuredHandler ??= createSqlLabApiHandler({
    workspaceId: process.env.WEB_IDE_WORKSPACE_ID,
    workspaceRoot: process.env.WEB_IDE_WORKSPACE_ROOT,
    token: process.env.WEB_IDE_WORKSPACE_TOKEN,
    databasePath: process.env.WEB_IDE_SQL_LAB_DATABASE_PATH,
  });
  return configuredHandler(request);
}

export function createSqlLabApiHandler(
  configuration: ServerSqlLabConfiguration,
): (request: Request) => Promise<Response> {
  const service = createSqlLabService(configuration);
  return (request) =>
    handleSqlLabApiRequest(request, {
      service,
      authorize(workspaceId) {
        const token = readCookie(request.headers.get("cookie"), "web_ide_workspace_token");
        if (
          !isConfiguredValue(configuration.workspaceId) ||
          !isConfiguredValue(configuration.token) ||
          workspaceId !== configuration.workspaceId ||
          token !== configuration.token
        ) {
          throw new SqlLabApiAuthorizationError();
        }
      },
    });
}

function createSqlLabService(configuration: ServerSqlLabConfiguration) {
  if (
    isConfiguredValue(configuration.databasePath) &&
    isConfiguredValue(configuration.workspaceRoot)
  ) {
    assertDatabasePathOutsideWorkspace(configuration.databasePath, configuration.workspaceRoot);
    return new SqlLabService({ databasePath: configuration.databasePath });
  }

  return {
    async run(): Promise<SqlLabResponse> {
      return {
        ok: false,
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "The SQL Lab database is unavailable.",
        },
      };
    },
  };
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

import { handleSqlLabApiRequest } from "@/server/sql-lab/api";
import { assertDatabasePathOutsideWorkspace } from "@/server/sql-lab/database-path";
import { SqlLabService } from "@/server/sql-lab/service";
import type { SqlLabResponse } from "@/sql-lab/contract";
import { isConfiguredValue } from "../configuration";
import { readCookie, resolveWorkspaceSessionCookieName } from "../workspace/session-cookie";

export interface ServerSqlLabConfiguration {
  workspaceId?: string;
  workspaceRoot?: string;
  token?: string;
  databasePath?: string;
  enabled?: string;
}

let configuredHandler: ((request: Request) => Promise<Response>) | undefined;

export function handleConfiguredSqlLabApiRequest(request: Request): Promise<Response> {
  configuredHandler ??= createSqlLabApiHandler({
    workspaceId: process.env.WEB_IDE_WORKSPACE_ID,
    workspaceRoot: process.env.WEB_IDE_WORKSPACE_ROOT,
    token: process.env.WEB_IDE_WORKSPACE_TOKEN,
    databasePath: process.env.WEB_IDE_SQL_LAB_DATABASE_PATH,
    enabled: process.env.WEB_IDE_LOCAL_SESSION_BOOTSTRAP,
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
        const token = readCookie(
          request.headers.get("cookie"),
          resolveWorkspaceSessionCookieName({
            enabled: configuration.enabled,
            host: request.headers.get("host") ?? undefined,
          }),
        );
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

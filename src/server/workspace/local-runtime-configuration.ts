import { randomBytes, createHash } from "node:crypto";
import { realpathSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface LocalRuntimeConfiguration {
  enabled: string;
  workspaceId: string;
  workspaceRoot: string;
  token: string;
  databasePath: string;
}

export function configureLocalRuntimeDefaults(): LocalRuntimeConfiguration {
  const configuration = resolveLocalRuntimeConfiguration(process.env);
  const databasePathWasUndefined = process.env.WEB_IDE_SQL_LAB_DATABASE_PATH === undefined;

  for (const [name, value] of Object.entries(configurationEnvironment(configuration))) {
    if (process.env[name] === undefined) {
      process.env[name] = value;
    }
  }

  if (databasePathWasUndefined) {
    mkdirSync(dirname(configuration.databasePath), { recursive: true });
  }

  return configuration;
}

export function resolveLocalRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
  currentWorkingDirectory = process.cwd(),
): LocalRuntimeConfiguration {
  const workspaceRoot = environment.WEB_IDE_WORKSPACE_ROOT ?? realpathSync(currentWorkingDirectory);
  const workspaceHash = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
  const workspaceId = envOrDefault(environment, "WEB_IDE_WORKSPACE_ID", `local-${workspaceHash}`);
  const token = envOrDefault(
    environment,
    "WEB_IDE_WORKSPACE_TOKEN",
    randomBytes(32).toString("hex"),
  );
  const databasePath = envOrDefault(
    environment,
    "WEB_IDE_SQL_LAB_DATABASE_PATH",
    join(tmpdir(), "web-ide", workspaceHash, "sql-lab.sqlite"),
  );

  return {
    enabled: envOrDefault(environment, "WEB_IDE_LOCAL_SESSION_BOOTSTRAP", "1"),
    workspaceId,
    workspaceRoot,
    token,
    databasePath,
  };
}

function envOrDefault(environment: NodeJS.ProcessEnv, name: string, defaultValue: string): string {
  const configuredValue = environment[name];
  if (configuredValue !== undefined) {
    return configuredValue;
  }
  return defaultValue;
}

function configurationEnvironment(
  configuration: LocalRuntimeConfiguration,
): Record<string, string> {
  return {
    WEB_IDE_LOCAL_SESSION_BOOTSTRAP: configuration.enabled,
    WEB_IDE_WORKSPACE_ID: configuration.workspaceId,
    WEB_IDE_WORKSPACE_ROOT: configuration.workspaceRoot,
    WEB_IDE_WORKSPACE_TOKEN: configuration.token,
    WEB_IDE_SQL_LAB_DATABASE_PATH: configuration.databasePath,
  };
}

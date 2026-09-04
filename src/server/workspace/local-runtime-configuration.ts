import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { isConfiguredValue } from "../configuration";
import { assertDatabasePathOutsideWorkspace } from "../sql-lab/database-path";

export interface LocalRuntimeConfiguration {
  enabled: string;
  workspaceId: string;
  workspaceRoot: string;
  token: string;
  databasePath: string;
}

export interface LocalRuntimePathOptions {
  temporaryDirectory?: string;
  homeDirectory?: string;
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
  currentWorkingDirectory?: string,
  pathOptions: LocalRuntimePathOptions = {},
): LocalRuntimeConfiguration {
  const configuredWorkspaceRoot = environment.WEB_IDE_WORKSPACE_ROOT;
  const workspaceRoot =
    configuredWorkspaceRoot !== undefined
      ? requireConfiguredValue("WEB_IDE_WORKSPACE_ROOT", configuredWorkspaceRoot)
      : realpathSync.native(currentWorkingDirectory ?? process.cwd());
  const canonicalWorkspaceRoot = canonicalWorkspaceRootPath(workspaceRoot);
  const workspaceHash = createHash("sha256")
    .update(canonicalWorkspaceRoot)
    .digest("hex")
    .slice(0, 16);
  const enabled = configuredOrDefault(environment, "WEB_IDE_LOCAL_SESSION_BOOTSTRAP", "1");
  if (enabled !== "0" && enabled !== "1") {
    throw configurationError('WEB_IDE_LOCAL_SESSION_BOOTSTRAP must be either "0" or "1".');
  }
  const workspaceId = configuredOrDefault(
    environment,
    "WEB_IDE_WORKSPACE_ID",
    `local-${workspaceHash}`,
  );
  const token = configuredOrDefault(
    environment,
    "WEB_IDE_WORKSPACE_TOKEN",
    randomBytes(32).toString("hex"),
  );
  const databasePath = resolveDatabasePath(environment, workspaceRoot, workspaceHash, pathOptions);

  return {
    enabled,
    workspaceId,
    workspaceRoot,
    token,
    databasePath,
  };
}

function resolveDatabasePath(
  environment: NodeJS.ProcessEnv,
  workspaceRoot: string,
  workspaceHash: string,
  pathOptions: LocalRuntimePathOptions,
): string {
  const configuredDatabasePath = environment.WEB_IDE_SQL_LAB_DATABASE_PATH;
  if (configuredDatabasePath !== undefined) {
    const databasePath = requireConfiguredValue(
      "WEB_IDE_SQL_LAB_DATABASE_PATH",
      configuredDatabasePath,
    );
    assertDatabasePathOutsideWorkspace(databasePath, workspaceRoot);
    return databasePath;
  }

  const primaryPath = join(
    pathOptions.temporaryDirectory ?? tmpdir(),
    "web-ide",
    workspaceHash,
    "sql-lab.sqlite",
  );
  if (isDatabasePathOutsideWorkspace(primaryPath, workspaceRoot)) {
    return primaryPath;
  }

  const fallbackPath = join(
    pathOptions.homeDirectory ?? homedir(),
    ".cache",
    "web-ide",
    workspaceHash,
    "sql-lab.sqlite",
  );
  if (isDatabasePathOutsideWorkspace(fallbackPath, workspaceRoot)) {
    return fallbackPath;
  }

  throw configurationError("Unable to choose a SQL Lab database path outside the workspace.");
}

function isDatabasePathOutsideWorkspace(databasePath: string, workspaceRoot: string): boolean {
  try {
    assertDatabasePathOutsideWorkspace(databasePath, workspaceRoot);
    return true;
  } catch {
    return false;
  }
}

function canonicalWorkspaceRootPath(workspaceRoot: string): string {
  try {
    return realpathSync.native(workspaceRoot);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return resolve(workspaceRoot);
    }
    throw configurationError("WEB_IDE_WORKSPACE_ROOT must be an accessible directory.");
  }
}

function configuredOrDefault(
  environment: NodeJS.ProcessEnv,
  name: string,
  defaultValue: string,
): string {
  const value = environment[name];
  return value === undefined ? defaultValue : requireConfiguredValue(name, value);
}

function requireConfiguredValue(name: string, value: string): string {
  if (!isConfiguredValue(value)) {
    throw configurationError(`${name} must not be blank.`);
  }
  return value;
}

function configurationError(message: string): Error {
  return new Error(`Invalid local runtime configuration: ${message}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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

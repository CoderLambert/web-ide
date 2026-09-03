import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function assertDatabasePathOutsideWorkspace(
  databasePath: string,
  workspaceRoot: string,
): void {
  const database = canonicalPath(databasePath);
  const workspace = canonicalPath(workspaceRoot);
  const pathFromWorkspace = relative(workspace, database);
  const isInsideWorkspace =
    pathFromWorkspace === "" ||
    (!pathFromWorkspace.startsWith(`..${sep}`) &&
      pathFromWorkspace !== ".." &&
      !isAbsolute(pathFromWorkspace));
  if (isInsideWorkspace) {
    throw new Error("SQL Lab database must be outside the workspace.");
  }
}

function canonicalPath(path: string): string {
  const resolved = resolve(path);
  if (existsSync(resolved)) {
    return realpathSync.native(resolved);
  }
  const parent = dirname(resolved);
  const canonicalParent = existsSync(parent) ? realpathSync.native(parent) : resolve(parent);
  return join(canonicalParent, basename(resolved));
}

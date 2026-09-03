import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function assertDatabasePathOutsideWorkspace(
  databasePath: string,
  workspaceRoot: string,
): void {
  if (databasePath.trim() === "" || workspaceRoot.trim() === "") {
    throw new Error("SQL Lab database and workspace paths are required.");
  }
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
  const missingSegments: string[] = [];
  let existingPath = resolved;
  while (!existsSync(existingPath)) {
    const parent = dirname(existingPath);
    if (parent === existingPath) {
      return resolved;
    }
    missingSegments.unshift(basename(existingPath));
    existingPath = parent;
  }
  return missingSegments.reduce(
    (current, segment) => join(current, segment),
    realpathSync.native(existingPath),
  );
}

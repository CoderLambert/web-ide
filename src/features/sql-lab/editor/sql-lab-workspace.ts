import type { WorkspaceEntry, WorkspaceFileSystem } from "@/workspace/file-system";
import type { WorkspacePath } from "@/workspace/path";

export async function listSqlDirectory(
  fileSystem: Pick<WorkspaceFileSystem, "list">,
  path: WorkspacePath,
): Promise<WorkspaceEntry[]> {
  const entries = await fileSystem.list(path);
  return entries
    .filter((entry) => entry.kind === "directory" || isSqlFileEntry(entry))
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    });
}

export function nextSqlFileName(paths: readonly WorkspacePath[]): WorkspacePath {
  const used = new Set(paths.map((path) => path.slice(path.lastIndexOf("/") + 1)));
  const base = "query.sql";
  if (!used.has(base)) {
    return base;
  }
  let suffix = 1;
  while (used.has(`query-${suffix}.sql`)) {
    suffix += 1;
  }
  return `query-${suffix}.sql`;
}

export function isSqlFileEntry(entry: WorkspaceEntry): boolean {
  return entry.kind === "file" && entry.path.toLowerCase().endsWith(".sql");
}

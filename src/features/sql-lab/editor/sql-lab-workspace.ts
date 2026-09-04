import type { WorkspaceEntry, WorkspaceFileSystem } from "@/workspace/file-system";
import type { WorkspacePath } from "@/workspace/path";

export function scheduleDirectoryLoad<T>(
  loads: Map<string, Promise<T>>,
  path: string,
  force: boolean,
  load: () => Promise<T>,
): Promise<T> {
  const existing = loads.get(path);
  if (!force && existing !== undefined) {
    return existing;
  }

  const task = (async () => {
    if (existing !== undefined) {
      await existing.catch(() => undefined);
    }
    return load();
  })();
  let trackedTask!: Promise<T>;
  trackedTask = task.finally(() => {
    if (loads.get(path) === trackedTask) {
      loads.delete(path);
    }
  });
  loads.set(path, trackedTask);
  return trackedTask;
}

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

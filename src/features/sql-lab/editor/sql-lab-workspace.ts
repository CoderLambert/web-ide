import type { WorkspaceEntry, WorkspaceFileSystem } from "@/workspace/file-system";
import type { WorkspacePath } from "@/workspace/path";

export interface DirectoryLoader<T> {
  load: (path: WorkspacePath, force?: boolean) => Promise<T>;
  getCached: (path: WorkspacePath) => T | undefined;
  clear: () => void;
}

export function createDirectoryLoader<T>(
  load: (path: WorkspacePath) => Promise<T>,
): DirectoryLoader<T> {
  const cache = new Map<WorkspacePath, T>();
  const loaded = new Set<WorkspacePath>();
  const inFlight = new Map<WorkspacePath, Promise<T>>();
  let generation = 0;

  return {
    load(path, force = false) {
      const current = inFlight.get(path);
      if (!force) {
        if (current !== undefined) {
          return current;
        }
        if (loaded.has(path)) {
          const cached = cache.get(path);
          if (cached === undefined) {
            throw new Error(`Missing cached value for ${path}.`);
          }
          return Promise.resolve(cached);
        }
      }

      const requestGeneration = generation;
      const task = (async () => {
        if (current !== undefined) {
          await current.catch(() => undefined);
        }
        return load(path);
      })();
      let trackedTask!: Promise<T>;
      trackedTask = task
        .then(
          (value) => {
            if (requestGeneration === generation) {
              cache.set(path, value);
              loaded.add(path);
            }
            return value;
          },
          (error: unknown) => {
            if (requestGeneration === generation) {
              loaded.delete(path);
            }
            throw error;
          },
        )
        .finally(() => {
          if (inFlight.get(path) === trackedTask) {
            inFlight.delete(path);
          }
        });
      inFlight.set(path, trackedTask);
      return trackedTask;
    },
    getCached(path) {
      return cache.get(path);
    },
    clear() {
      generation += 1;
      cache.clear();
      loaded.clear();
      inFlight.clear();
    },
  };
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

const GENERATED_DIRECTORY_NAMES = new Set(["node_modules", "dist", "build", "coverage"]);

export function isHiddenSqlDirectory(path: WorkspacePath): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return basename.startsWith(".") || GENERATED_DIRECTORY_NAMES.has(basename);
}

export function projectSqlDirectoryEntries(
  entries: readonly WorkspaceEntry[],
  showHidden: boolean,
): WorkspaceEntry[] {
  return entries.filter(
    (entry) =>
      isSqlFileEntry(entry) ||
      (entry.kind === "directory" && (showHidden || !isHiddenSqlDirectory(entry.path))),
  );
}

export function workspaceBasename(path: WorkspacePath): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

import type { WorkspaceEntry, WorkspaceFileSystem } from "@/workspace/file-system";
import type { WorkspacePath } from "@/workspace/path";

export async function listSqlFiles(
  fileSystem: Pick<WorkspaceFileSystem, "list">,
): Promise<WorkspacePath[]> {
  const files: WorkspacePath[] = [];
  const visit = async (path: WorkspacePath): Promise<void> => {
    const entries = await fileSystem.list(path);
    for (const entry of entries) {
      if (entry.kind === "directory") {
        await visit(entry.path);
      } else if (entry.path.toLowerCase().endsWith(".sql")) {
        files.push(entry.path);
      }
    }
  };
  await visit("");
  return files.sort((left, right) => left.localeCompare(right));
}

export function nextSqlFileName(paths: readonly WorkspacePath[]): WorkspacePath {
  const used = new Set(paths);
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

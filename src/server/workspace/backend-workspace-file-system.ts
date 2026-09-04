import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import writeFileAtomic from "write-file-atomic";

import {
  WorkspaceFileSystemError,
  type WorkspaceEntry,
  type WorkspaceFileSystem,
  type WorkspaceFileSystemErrorCode,
} from "../../workspace/file-system";
import { validateWorkspacePath, type WorkspacePath } from "../../workspace/path";

type ExistingEntry = Awaited<ReturnType<typeof lstat>>;

export class BackendWorkspaceFileSystem implements WorkspaceFileSystem {
  readonly #boundRoot: string;

  constructor(boundRoot: string) {
    this.#boundRoot = resolve(boundRoot);
  }

  async list(path: WorkspacePath): Promise<WorkspaceEntry[]> {
    const workspacePath = this.validatePath(path, true);

    return this.run("list", async () => {
      const { target, stats } = await this.resolveExisting(workspacePath);
      if (!stats.isDirectory()) {
        throw failure("NOT_DIRECTORY", "Workspace path is not a directory.");
      }

      const entries = await readdir(target, { withFileTypes: true });
      return entries.flatMap<WorkspaceEntry>((entry) => {
        if (!entry.isFile() && !entry.isDirectory()) {
          return [];
        }

        const entryPath = workspacePath === "" ? entry.name : `${workspacePath}/${entry.name}`;
        try {
          validateWorkspacePath(entryPath);
        } catch {
          return [];
        }

        return [
          {
            path: entryPath,
            kind: entry.isDirectory() ? "directory" : "file",
          },
        ];
      });
    });
  }

  async readFile(path: WorkspacePath): Promise<string> {
    const workspacePath = this.validatePath(path);

    return this.run("read file", async () => {
      const { target, stats } = await this.resolveExisting(workspacePath);
      this.requireFile(stats);
      const content = await readFile(target);

      try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
      } catch {
        throw failure("UNSUPPORTED", "Workspace file is not valid UTF-8 text.");
      }
    });
  }

  async writeFile(path: WorkspacePath, content: string): Promise<void> {
    const workspacePath = this.validatePath(path);

    await this.run("write file", async () => {
      const { target, stats } = await this.resolveExisting(workspacePath);
      this.requireFile(stats);
      await writeFileAtomic(target, content, {
        encoding: "utf8",
        fsync: true,
      });
    });
  }

  async createFile(path: WorkspacePath): Promise<void> {
    const workspacePath = this.validatePath(path);

    await this.run("create file", async () => {
      const target = await this.resolveCreatable(workspacePath);
      await writeFile(target, "", { encoding: "utf8", flag: "wx" });
    });
  }

  async createDirectory(path: WorkspacePath): Promise<void> {
    const workspacePath = this.validatePath(path);

    await this.run("create directory", async () => {
      const target = await this.resolveCreatable(workspacePath);
      await mkdir(target);
    });
  }

  async rename(from: WorkspacePath, to: WorkspacePath): Promise<void> {
    const sourcePath = this.validatePath(from);
    const destinationPath = this.validatePath(to);

    await this.run("rename entry", async () => {
      const { target: source } = await this.resolveExisting(sourcePath);
      const destination = await this.resolveCreatable(destinationPath);
      await rename(source, destination);
    });
  }

  async delete(path: WorkspacePath): Promise<void> {
    const workspacePath = this.validatePath(path);

    await this.run("delete entry", async () => {
      const { target, stats } = await this.resolveExisting(workspacePath);
      if (stats.isFile()) {
        await unlink(target);
        return;
      }
      if (stats.isDirectory()) {
        await rmdir(target);
        return;
      }
      throw failure("UNSUPPORTED", "Workspace entry type is unsupported.");
    });
  }

  private validatePath(path: string, allowRoot = false): WorkspacePath {
    try {
      return validateWorkspacePath(path, { allowRoot });
    } catch {
      throw failure("INVALID_PATH", "Invalid workspace path.");
    }
  }

  private async resolveRoot(): Promise<string> {
    const rootStats = await lstat(this.#boundRoot);
    if (!rootStats.isDirectory()) {
      throw failure("NOT_DIRECTORY", "Workspace root is not a directory.");
    }
    return realpath(this.#boundRoot);
  }

  private async resolveExisting(
    workspacePath: WorkspacePath,
  ): Promise<{ target: string; stats: ExistingEntry }> {
    const root = await this.resolveRoot();
    if (workspacePath === "") {
      return { target: root, stats: await lstat(root) };
    }

    let target = root;
    let stats: ExistingEntry | undefined;
    for (const segment of workspacePath.split("/")) {
      target = resolve(target, segment);
      this.requireContained(root, target);
      stats = await lstat(target);
      if (stats.isSymbolicLink()) {
        throw failure("UNSUPPORTED", "Symbolic links are not supported.");
      }
    }

    const resolvedTarget = await realpath(target);
    this.requireContained(root, resolvedTarget);
    return { target: resolvedTarget, stats: stats! };
  }

  private async resolveCreatable(workspacePath: WorkspacePath): Promise<string> {
    const root = await this.resolveRoot();
    const target = resolve(root, ...workspacePath.split("/"));
    this.requireContained(root, target);

    const parentWorkspacePath = parentOf(workspacePath);
    const { target: parent, stats } = await this.resolveExisting(parentWorkspacePath);
    if (!stats.isDirectory()) {
      throw failure("NOT_DIRECTORY", "Workspace parent is not a directory.");
    }
    this.requireContained(root, parent);

    try {
      const targetStats = await lstat(target);
      if (targetStats.isSymbolicLink()) {
        throw failure("UNSUPPORTED", "Symbolic links are not supported.");
      }
      throw failure("ALREADY_EXISTS", "Workspace entry already exists.");
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    return target;
  }

  private requireContained(root: string, target: string): void {
    const relativePath = relative(root, target);
    if (
      relativePath === "" ||
      (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
    ) {
      return;
    }
    throw failure("FORBIDDEN", "Workspace path escapes the bound workspace.");
  }

  private requireFile(stats: ExistingEntry): void {
    if (stats.isDirectory()) {
      throw failure("NOT_FILE", "Workspace path is not a file.");
    }
    if (!stats.isFile()) {
      throw failure("UNSUPPORTED", "Workspace entry type is unsupported.");
    }
  }

  private async run<T>(operation: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof WorkspaceFileSystemError) {
        throw error;
      }
      throw mapNodeError(error, operation);
    }
  }
}

function parentOf(path: WorkspacePath): WorkspacePath {
  const parent = dirname(path.replaceAll("/", sep));
  return parent === "." ? "" : parent.split(sep).join("/");
}

function failure(code: WorkspaceFileSystemErrorCode, message: string): WorkspaceFileSystemError {
  return new WorkspaceFileSystemError(code, message);
}

function mapNodeError(error: unknown, operation: string): WorkspaceFileSystemError {
  const code = isNodeError(error) ? error.code : undefined;
  const mappedCode: WorkspaceFileSystemErrorCode =
    code === "ENOENT"
      ? "NOT_FOUND"
      : code === "EEXIST" && operation === "delete entry"
        ? "DIRECTORY_NOT_EMPTY"
        : code === "EEXIST"
          ? "ALREADY_EXISTS"
          : code === "ENOTDIR"
            ? "NOT_DIRECTORY"
            : code === "EISDIR"
              ? "NOT_FILE"
              : code === "ENOTEMPTY"
                ? "DIRECTORY_NOT_EMPTY"
                : code === "EACCES" || code === "EPERM"
                  ? "FORBIDDEN"
                  : code === "ELOOP"
                    ? "UNSUPPORTED"
                    : "IO_ERROR";

  return failure(mappedCode, `Unable to ${operation}.`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

import { describe, expect, it } from "vite-plus/test";

import {
  WORKSPACE_FILE_SYSTEM_ERROR_CODES,
  WorkspaceFileSystemError,
  type WorkspaceEntry,
  type WorkspaceFileSystem,
} from "../../../src/workspace/file-system";
import { validateWorkspacePath, type WorkspacePath } from "../../../src/workspace/path";
import {
  encodedTraversalTransportPaths,
  invalidWorkspacePaths,
} from "../../fixtures/workspace-paths";

class ContractFileSystem implements WorkspaceFileSystem {
  readonly entries = new Map<WorkspacePath, WorkspaceEntry>([
    ["src", { path: "src", kind: "directory" }],
    ["src/main.ts", { path: "src/main.ts", kind: "file" }],
  ]);

  async list(path: WorkspacePath): Promise<WorkspaceEntry[]> {
    validateWorkspacePath(path, { allowRoot: true });
    if (path === "") {
      return [{ path: "src", kind: "directory" }];
    }
    this.requireNonRoot(path);
    return [{ path: `${path}/main.ts`, kind: "file" }];
  }

  async readFile(path: WorkspacePath): Promise<string> {
    this.requireNonRoot(path);
    return "select 1;";
  }

  async writeFile(path: WorkspacePath, _content: string): Promise<void> {
    this.requireNonRoot(path);
  }

  async createFile(path: WorkspacePath): Promise<void> {
    this.requireNonRoot(path);
  }

  async createDirectory(path: WorkspacePath): Promise<void> {
    this.requireNonRoot(path);
  }

  async rename(from: WorkspacePath, to: WorkspacePath): Promise<void> {
    this.requireNonRoot(from);
    this.requireNonRoot(to);
  }

  async delete(path: WorkspacePath): Promise<void> {
    this.requireNonRoot(path);
  }

  private requireNonRoot(path: WorkspacePath): void {
    try {
      validateWorkspacePath(path);
    } catch (error) {
      throw new WorkspaceFileSystemError("INVALID_PATH", "Invalid workspace path.", {
        cause: error,
      });
    }
  }
}

describe("WorkspaceFileSystem contract", () => {
  it("binds operations to a workspace without repeating workspace identity", () => {
    const methodNames: Array<keyof WorkspaceFileSystem> = [
      "list",
      "readFile",
      "writeFile",
      "createFile",
      "createDirectory",
      "rename",
      "delete",
    ];
    const fileSystem = new ContractFileSystem();

    for (const methodName of methodNames) {
      expect(typeof fileSystem[methodName]).toBe("function");
    }
  });

  it("allows root only for list and returns complete paths for direct children", async () => {
    const fileSystem = new ContractFileSystem();

    await expect(fileSystem.list("")).resolves.toEqual([{ path: "src", kind: "directory" }]);
    await expect(fileSystem.list("src")).resolves.toEqual([{ path: "src/main.ts", kind: "file" }]);

    await expect(fileSystem.readFile("")).rejects.toMatchObject({ code: "INVALID_PATH" });
    await expect(fileSystem.writeFile("", "content")).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    await expect(fileSystem.createFile("")).rejects.toMatchObject({ code: "INVALID_PATH" });
    await expect(fileSystem.createDirectory("")).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    await expect(fileSystem.rename("", "target")).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    await expect(fileSystem.rename("source", "")).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    await expect(fileSystem.delete("")).rejects.toMatchObject({ code: "INVALID_PATH" });
  });

  it("reuses the shared WorkspacePath rejection semantics", async () => {
    const fileSystem = new ContractFileSystem();
    const decodedTraversalPaths = encodedTraversalTransportPaths.map(decodeURIComponent);

    for (const path of [...invalidWorkspacePaths, ...decodedTraversalPaths]) {
      await expect(fileSystem.readFile(path)).rejects.toMatchObject({ code: "INVALID_PATH" });
    }
  });

  it("publishes the complete stable project-level error vocabulary", () => {
    expect(WORKSPACE_FILE_SYSTEM_ERROR_CODES).toEqual([
      "INVALID_PATH",
      "NOT_FOUND",
      "ALREADY_EXISTS",
      "NOT_FILE",
      "NOT_DIRECTORY",
      "DIRECTORY_NOT_EMPTY",
      "FORBIDDEN",
      "UNSUPPORTED",
      "IO_ERROR",
    ]);

    const cause = new Error("host detail");
    const error = new WorkspaceFileSystemError("IO_ERROR", "Workspace operation failed.", {
      cause,
    });
    expect(error).toMatchObject({
      name: "WorkspaceFileSystemError",
      code: "IO_ERROR",
      message: "Workspace operation failed.",
      cause,
    });
  });

  it("keeps entries limited to path and kind", () => {
    const entry: WorkspaceEntry = { path: "src/main.ts", kind: "file" };

    expect(entry).toEqual({ path: "src/main.ts", kind: "file" });
    expect(entry).not.toHaveProperty("languageId");
    expect(entry).not.toHaveProperty("content");
  });
});

import {
  mkdtemp,
  lstat,
  mkdir,
  readFile as readHostFile,
  readdir,
  rm,
  symlink,
  writeFile as writeHostFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { BackendWorkspaceFileSystem } from "../../../../src/server/workspace/backend-workspace-file-system";
import { createAuthorizedWorkspaceFileSystem } from "../../../../src/server/workspace/authorized-workspace-file-system";
import { WorkspaceFileSystemError } from "../../../../src/workspace/file-system";
import {
  encodedTraversalTransportPaths,
  invalidWorkspacePaths,
} from "../../../fixtures/workspace-paths";

let workspaceRoot: string;
let outsideRoot: string;
let fileSystem: BackendWorkspaceFileSystem;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "web-ide-w03-workspace-"));
  outsideRoot = await mkdtemp(join(tmpdir(), "web-ide-w03-outside-"));
  fileSystem = new BackendWorkspaceFileSystem(workspaceRoot);
});

afterEach(async () => {
  await Promise.all([
    rm(workspaceRoot, { force: true, recursive: true }),
    rm(outsideRoot, { force: true, recursive: true }),
  ]);
});

describe("BackendWorkspaceFileSystem", () => {
  it("persists UTF-8 CRUD operations and lists only direct children", async () => {
    await mkdir(join(workspaceRoot, "src"));
    await writeHostFile(join(workspaceRoot, "README.md"), "workspace\n", "utf8");
    await writeHostFile(join(workspaceRoot, "src", "main.ts"), "const value = 1;\n", "utf8");

    expect(sortEntries(await fileSystem.list(""))).toEqual([
      { path: "README.md", kind: "file" },
      { path: "src", kind: "directory" },
    ]);
    expect(await fileSystem.list("src")).toEqual([{ path: "src/main.ts", kind: "file" }]);
    expect(await fileSystem.readFile("src/main.ts")).toBe("const value = 1;\n");

    await fileSystem.writeFile("src/main.ts", "const value = 2;\n");
    expect(await readHostFile(join(workspaceRoot, "src", "main.ts"), "utf8")).toBe(
      "const value = 2;\n",
    );
    await fileSystem.writeFile("src/main.ts", "short");
    expect(await readHostFile(join(workspaceRoot, "src", "main.ts"), "utf8")).toBe("short");

    await fileSystem.createFile("src/new.txt");
    expect(await readHostFile(join(workspaceRoot, "src", "new.txt"), "utf8")).toBe("");
    await fileSystem.createDirectory("src/nested");
    expect(sortEntries(await fileSystem.list("src"))).toEqual([
      { path: "src/main.ts", kind: "file" },
      { path: "src/nested", kind: "directory" },
      { path: "src/new.txt", kind: "file" },
    ]);

    await fileSystem.rename("src/new.txt", "src/renamed.txt");
    expect(await fileSystem.readFile("src/renamed.txt")).toBe("");
    await fileSystem.delete("src/renamed.txt");
    await fileSystem.delete("src/nested");
    await expectCode(() => fileSystem.readFile("src/renamed.txt"), "NOT_FOUND");

    // The nested file is not returned by list(""); only direct children are exposed.
    expect(sortEntries(await fileSystem.list(""))).toEqual([
      { path: "README.md", kind: "file" },
      { path: "src", kind: "directory" },
    ]);
  });

  it("allows the workspace root only for list", async () => {
    await expectCode(() => fileSystem.readFile(""), "INVALID_PATH");
    await expectCode(() => fileSystem.writeFile("", "content"), "INVALID_PATH");
    await expectCode(() => fileSystem.createFile(""), "INVALID_PATH");
    await expectCode(() => fileSystem.createDirectory(""), "INVALID_PATH");
    await expectCode(() => fileSystem.rename("", "target"), "INVALID_PATH");
    await expectCode(() => fileSystem.rename("source", ""), "INVALID_PATH");
    await expectCode(() => fileSystem.delete(""), "INVALID_PATH");
    await expect(fileSystem.list("")).resolves.toEqual([]);
  });

  it("reuses W-01 invalid and decoded traversal path semantics", async () => {
    for (const path of [
      ...invalidWorkspacePaths,
      ...encodedTraversalTransportPaths.map(decodeURIComponent),
    ]) {
      await expectCode(() => fileSystem.readFile(path), "INVALID_PATH");
      await expectCode(() => fileSystem.writeFile(path, "content"), "INVALID_PATH");
      await expectCode(() => fileSystem.createFile(path), "INVALID_PATH");
      await expectCode(() => fileSystem.createDirectory(path), "INVALID_PATH");
      await expectCode(() => fileSystem.list(path), "INVALID_PATH");
      await expectCode(() => fileSystem.delete(path), "INVALID_PATH");
      await expectCode(() => fileSystem.rename(path, "target.txt"), "INVALID_PATH");
      await expectCode(() => fileSystem.rename("target.txt", path), "INVALID_PATH");
    }

    expect(await readdir(workspaceRoot)).toEqual([]);
  });

  it("does not implicitly create on write and maps filesystem conditions to stable codes", async () => {
    await mkdir(join(workspaceRoot, "src"));
    await writeHostFile(join(workspaceRoot, "existing.txt"), "existing", "utf8");

    await expectCode(() => fileSystem.writeFile("missing.txt", "content"), "NOT_FOUND");
    await expectCode(() => fileSystem.readFile("src"), "NOT_FILE");
    await expectCode(() => fileSystem.writeFile("src", "content"), "NOT_FILE");
    await expectCode(() => fileSystem.list("existing.txt"), "NOT_DIRECTORY");

    await expectCode(() => fileSystem.createFile("existing.txt"), "ALREADY_EXISTS");
    await expectCode(() => fileSystem.createDirectory("existing.txt"), "ALREADY_EXISTS");
    await expectCode(() => fileSystem.createFile("missing-parent/new.txt"), "NOT_FOUND");
    await expectCode(() => fileSystem.createDirectory("missing-parent/new-dir"), "NOT_FOUND");
    await expectCode(() => fileSystem.createFile("existing.txt/child.txt"), "NOT_DIRECTORY");
    await expectCode(() => fileSystem.createDirectory("existing.txt/child-dir"), "NOT_DIRECTORY");

    await expectCode(() => fileSystem.rename("missing.txt", "renamed.txt"), "NOT_FOUND");
    await expectCode(() => fileSystem.rename("existing.txt", "src"), "ALREADY_EXISTS");
    await expectCode(
      () => fileSystem.rename("existing.txt", "missing-parent/renamed.txt"),
      "NOT_FOUND",
    );
    await expectCode(
      () => fileSystem.rename("existing.txt", "existing.txt/renamed.txt"),
      "NOT_DIRECTORY",
    );

    await expectCode(() => fileSystem.delete("missing.txt"), "NOT_FOUND");
    await writeHostFile(join(workspaceRoot, "src", "child.txt"), "child", "utf8");
    await expectCode(() => fileSystem.delete("src"), "DIRECTORY_NOT_EMPTY");
    expect(await readHostFile(join(workspaceRoot, "src", "child.txt"), "utf8")).toBe("child");
  });

  it("rejects non-UTF-8 persisted content as unsupported text", async () => {
    await writeHostFile(join(workspaceRoot, "binary.dat"), Uint8Array.from([0xff, 0xfe]));

    await expectCode(() => fileSystem.readFile("binary.dat"), "UNSUPPORTED");
  });

  it("preserves a leading UTF-8 BOM across write and read", async () => {
    const content = "\uFEFFselect 1;";
    await writeHostFile(join(workspaceRoot, "bom.sql"), "initial", "utf8");

    await fileSystem.writeFile("bom.sql", content);

    expect(await fileSystem.readFile("bom.sql")).toBe(content);
    expect(await readHostFile(join(workspaceRoot, "bom.sql"))).toEqual(
      Buffer.from(content, "utf8"),
    );
  });

  it("authorizes workspace identity before resolving its server-owned root", async () => {
    const calls: string[] = [];
    const authorized = await createAuthorizedWorkspaceFileSystem(
      "allowed-workspace",
      {
        async authorize(workspaceId) {
          calls.push(`authorize:${workspaceId}`);
        },
      },
      {
        async resolveRoot(workspaceId) {
          calls.push(`resolve:${workspaceId}`);
          return workspaceRoot;
        },
      },
    );

    expect(calls).toEqual(["authorize:allowed-workspace", "resolve:allowed-workspace"]);
    await expect(authorized.list("")).resolves.toEqual([]);

    let rootResolved = false;
    await expect(
      createAuthorizedWorkspaceFileSystem(
        "denied-workspace",
        {
          async authorize() {
            throw new WorkspaceFileSystemError("FORBIDDEN", "Workspace access denied.");
          },
        },
        {
          async resolveRoot() {
            rootResolved = true;
            return outsideRoot;
          },
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rootResolved).toBe(false);
  });

  it("does not expose bound host paths through normalized operation errors", async () => {
    let caught: unknown;
    try {
      await fileSystem.readFile("missing.txt");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkspaceFileSystemError);
    expect(String(caught)).not.toContain(workspaceRoot);
    expect(JSON.stringify(caught)).not.toContain(workspaceRoot);
    expect((caught as Error).cause).toBeUndefined();
  });

  it("rejects real intermediate and target symlinks, while hiding them from list", async () => {
    await mkdir(join(workspaceRoot, "real-dir"));
    await writeHostFile(join(workspaceRoot, "real-dir", "child.txt"), "child", "utf8");
    await writeHostFile(join(workspaceRoot, "real-file.txt"), "file", "utf8");
    await symlink(join(workspaceRoot, "real-dir"), join(workspaceRoot, "intermediate-link"));
    await symlink(join(workspaceRoot, "real-file.txt"), join(workspaceRoot, "target-link.txt"));

    expect(sortEntries(await fileSystem.list(""))).toEqual([
      { path: "real-dir", kind: "directory" },
      { path: "real-file.txt", kind: "file" },
    ]);

    await expectSymlinkDenied(() => fileSystem.list("intermediate-link"));
    await expectSymlinkDenied(() => fileSystem.readFile("intermediate-link/child.txt"));
    await expectSymlinkDenied(() => fileSystem.createFile("intermediate-link/new.txt"));
    await expectSymlinkDenied(() => fileSystem.createDirectory("intermediate-link/new-dir"));

    await expectSymlinkDenied(() => fileSystem.readFile("target-link.txt"));
    await expectSymlinkDenied(() => fileSystem.writeFile("target-link.txt", "changed"));
    await expectSymlinkDenied(() => fileSystem.delete("target-link.txt"));
    await expectSymlinkDenied(() => fileSystem.rename("target-link.txt", "renamed.txt"));
    await expectSymlinkDenied(() => fileSystem.rename("real-file.txt", "target-link.txt"));

    expect(await readHostFile(join(workspaceRoot, "real-file.txt"), "utf8")).toBe("file");
    expect((await lstat(join(workspaceRoot, "target-link.txt"))).isSymbolicLink()).toBe(true);
  });

  it("denies every external-symlink escape attempt without touching outside content", async () => {
    const outsideFile = join(outsideRoot, "secret.txt");
    const outsideDirectory = join(outsideRoot, "directory");
    await writeHostFile(outsideFile, "do not change", "utf8");
    await mkdir(outsideDirectory);
    await symlink(outsideFile, join(workspaceRoot, "external-file-link"));
    await symlink(outsideDirectory, join(workspaceRoot, "external-directory-link"));
    await writeHostFile(join(workspaceRoot, "source.txt"), "source", "utf8");

    await expectSymlinkDenied(() => fileSystem.readFile("external-file-link"));
    await expectSymlinkDenied(() => fileSystem.writeFile("external-file-link", "changed"));
    await expectSymlinkDenied(() => fileSystem.delete("external-file-link"));
    await expectSymlinkDenied(() => fileSystem.createFile("external-directory-link/created.txt"));
    await expectSymlinkDenied(() =>
      fileSystem.createDirectory("external-directory-link/created-dir"),
    );
    await expectSymlinkDenied(() =>
      fileSystem.rename("source.txt", "external-directory-link/moved.txt"),
    );
    await expectSymlinkDenied(() => fileSystem.rename("source.txt", "external-file-link"));

    expect(await readHostFile(outsideFile, "utf8")).toBe("do not change");
    expect(await readdir(outsideDirectory)).toEqual([]);
    expect(await readHostFile(join(workspaceRoot, "source.txt"), "utf8")).toBe("source");
  });
});

function sortEntries(entries: Awaited<ReturnType<BackendWorkspaceFileSystem["list"]>>) {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

async function expectCode(operation: () => Promise<unknown>, code: string): Promise<void> {
  await expect(operation()).rejects.toMatchObject({
    code,
  });
}

async function expectSymlinkDenied(operation: () => Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(WorkspaceFileSystemError);
  expect(caught).toMatchObject({
    code: expect.stringMatching(/^(FORBIDDEN|UNSUPPORTED)$/),
  });
}

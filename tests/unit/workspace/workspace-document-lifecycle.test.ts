import { describe, expect, it } from "vite-plus/test";

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type { WorkspaceModelService } from "../../../src/editor/monaco/workspace-model-service";
import {
  WorkspaceDocumentManager,
  type WorkspaceSyntaxBinding,
} from "../../../src/workspace/workspace-document-manager";
import {
  WorkspaceFileSystemError,
  type WorkspaceEntry,
  type WorkspaceFileSystem,
} from "../../../src/workspace/file-system";
import { validateWorkspacePath, type WorkspacePath } from "../../../src/workspace/path";

type ContentListener = (event: Monaco.editor.IModelContentChangedEvent) => void;
type DisposeListener = () => void;

interface PendingWrite {
  path: WorkspacePath;
  content: string;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * A small stateful filesystem makes the lifecycle assertions meaningful: a
 * reopened document must come from the renamed/deleted persisted path, not
 * from a manager or browser-side cache.
 */
class StatefulWorkspaceFileSystem implements WorkspaceFileSystem {
  readonly operations: Array<
    | { operation: "createFile"; path: WorkspacePath }
    | { operation: "createDirectory"; path: WorkspacePath }
    | { operation: "rename"; from: WorkspacePath; to: WorkspacePath }
    | { operation: "delete"; path: WorkspacePath }
  > = [];
  readonly writes: Array<{ path: WorkspacePath; content: string }> = [];
  readonly pendingWrites: PendingWrite[] = [];
  readonly pendingReads: Array<() => void> = [];
  readonly pendingRenames: Array<() => void> = [];
  readonly pendingDeletes: Array<() => void> = [];
  readonly #files = new Map<WorkspacePath, string>();
  readonly #directories = new Set<WorkspacePath>([""]);
  deferWrites = false;
  deferReads = false;
  deferRenames = false;
  deferDeletes = false;
  failNextCreateFile: WorkspaceFileSystemError | undefined;
  failNextCreateDirectory: WorkspaceFileSystemError | undefined;
  failNextRename: WorkspaceFileSystemError | undefined;
  failNextDelete: WorkspaceFileSystemError | undefined;

  constructor(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      this.addFile(path as WorkspacePath, content);
    }
  }

  get persisted(): ReadonlyMap<WorkspacePath, string> {
    return this.#files;
  }

  get directories(): ReadonlySet<WorkspacePath> {
    return this.#directories;
  }

  async list(path: WorkspacePath): Promise<WorkspaceEntry[]> {
    validateWorkspacePath(path, { allowRoot: true });
    this.requireDirectory(path);
    const prefix = path === "" ? "" : `${path}/`;
    const entries: WorkspaceEntry[] = [];
    for (const directory of this.#directories) {
      if (directory === "" || !directory.startsWith(prefix)) {
        continue;
      }
      const remainder = directory.slice(prefix.length);
      if (!remainder.includes("/")) {
        entries.push({ path: directory, kind: "directory" });
      }
    }
    for (const file of this.#files.keys()) {
      if (!file.startsWith(prefix)) {
        continue;
      }
      const remainder = file.slice(prefix.length);
      if (!remainder.includes("/")) {
        entries.push({ path: file, kind: "file" });
      }
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  async readFile(path: WorkspacePath): Promise<string> {
    validateWorkspacePath(path);
    if (this.deferReads) {
      await new Promise<void>((resolve) => this.pendingReads.push(resolve));
    }
    const content = this.#files.get(path);
    if (content === undefined) {
      throw new WorkspaceFileSystemError("NOT_FOUND", `Workspace file not found: ${path}`);
    }
    return content;
  }

  writeFile(path: WorkspacePath, content: string): Promise<void> {
    validateWorkspacePath(path);
    this.requireFile(path);
    this.writes.push({ path, content });
    if (!this.deferWrites) {
      this.#files.set(path, content);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingWrites.push({ path, content, resolve, reject });
    });
  }

  async createFile(path: WorkspacePath): Promise<void> {
    validateWorkspacePath(path);
    this.operations.push({ operation: "createFile", path });
    const failure = this.failNextCreateFile;
    this.failNextCreateFile = undefined;
    if (failure !== undefined) {
      throw failure;
    }
    if (this.#files.has(path) || this.#directories.has(path)) {
      throw new WorkspaceFileSystemError("ALREADY_EXISTS", "Path already exists.");
    }
    this.requireParentDirectory(path);
    this.#files.set(path, "");
  }

  async createDirectory(path: WorkspacePath): Promise<void> {
    validateWorkspacePath(path);
    this.operations.push({ operation: "createDirectory", path });
    const failure = this.failNextCreateDirectory;
    this.failNextCreateDirectory = undefined;
    if (failure !== undefined) {
      throw failure;
    }
    if (this.#files.has(path) || this.#directories.has(path)) {
      throw new WorkspaceFileSystemError("ALREADY_EXISTS", "Path already exists.");
    }
    this.requireParentDirectory(path);
    this.#directories.add(path);
  }

  async rename(from: WorkspacePath, to: WorkspacePath): Promise<void> {
    validateWorkspacePath(from);
    validateWorkspacePath(to);
    this.operations.push({ operation: "rename", from, to });
    const failure = this.failNextRename;
    this.failNextRename = undefined;
    if (failure !== undefined) {
      throw failure;
    }
    if (this.deferRenames) {
      await new Promise<void>((resolve) => this.pendingRenames.push(resolve));
    }
    if (this.#files.has(to) || this.#directories.has(to)) {
      throw new WorkspaceFileSystemError("ALREADY_EXISTS", "Destination already exists.");
    }
    this.requireParentDirectory(to);
    if (this.#files.has(from)) {
      const content = this.#files.get(from)!;
      this.#files.delete(from);
      this.#files.set(to, content);
      return;
    }
    if (!this.#directories.has(from)) {
      throw new WorkspaceFileSystemError("NOT_FOUND", "Source path not found.");
    }
    const directoryPrefix = `${from}/`;
    const fileMoves = [...this.#files.entries()].filter(([path]) =>
      path.startsWith(directoryPrefix),
    );
    const directoryMoves = [...this.#directories].filter(
      (path) => path === from || path.startsWith(directoryPrefix),
    );
    for (const path of directoryMoves) {
      this.#directories.delete(path);
    }
    for (const [path] of fileMoves) {
      this.#files.delete(path);
    }
    for (const path of directoryMoves) {
      this.#directories.add(`${to}${path.slice(from.length)}` as WorkspacePath);
    }
    for (const [path, content] of fileMoves) {
      this.#files.set(`${to}${path.slice(from.length)}` as WorkspacePath, content);
    }
  }

  async delete(path: WorkspacePath): Promise<void> {
    validateWorkspacePath(path);
    this.operations.push({ operation: "delete", path });
    const failure = this.failNextDelete;
    this.failNextDelete = undefined;
    if (failure !== undefined) {
      throw failure;
    }
    if (this.deferDeletes) {
      await new Promise<void>((resolve) => this.pendingDeletes.push(resolve));
    }
    if (this.#files.delete(path)) {
      return;
    }
    if (!this.#directories.has(path)) {
      throw new WorkspaceFileSystemError("NOT_FOUND", "Path not found.");
    }
    if ([...this.#files.keys()].some((file) => file.startsWith(`${path}/`))) {
      throw new WorkspaceFileSystemError("DIRECTORY_NOT_EMPTY", "Directory is not empty.");
    }
    if ([...this.#directories].some((directory) => directory.startsWith(`${path}/`))) {
      throw new WorkspaceFileSystemError("DIRECTORY_NOT_EMPTY", "Directory is not empty.");
    }
    this.#directories.delete(path);
  }

  releaseNextWrite(): void {
    const pending = this.pendingWrites.shift();
    if (pending === undefined) {
      throw new Error("No deferred write is pending.");
    }
    this.#files.set(pending.path, pending.content);
    pending.resolve();
  }

  rejectNextWrite(error: unknown): void {
    const pending = this.pendingWrites.shift();
    if (pending === undefined) {
      throw new Error("No deferred write is pending.");
    }
    pending.reject(error);
  }

  releaseNextRead(): void {
    release(this.pendingReads, "read");
  }

  releaseNextRename(): void {
    release(this.pendingRenames, "rename");
  }

  releaseNextDelete(): void {
    release(this.pendingDeletes, "delete");
  }

  private addFile(path: WorkspacePath, content: string): void {
    validateWorkspacePath(path);
    this.requireParentDirectories(path);
    this.#files.set(path, content);
  }

  private requireParentDirectories(path: WorkspacePath): void {
    const segments = path.split("/");
    segments.pop();
    let current = "";
    for (const segment of segments) {
      current = current === "" ? segment : `${current}/${segment}`;
      this.#directories.add(current as WorkspacePath);
    }
  }

  private requireParentDirectory(path: WorkspacePath): void {
    const separator = path.lastIndexOf("/");
    const parent = separator === -1 ? "" : (path.slice(0, separator) as WorkspacePath);
    this.requireDirectory(parent);
  }

  private requireDirectory(path: WorkspacePath): void {
    if (!this.#directories.has(path)) {
      throw new WorkspaceFileSystemError("NOT_DIRECTORY", "Parent is not a directory.");
    }
  }

  private requireFile(path: WorkspacePath): void {
    if (!this.#files.has(path)) {
      throw new WorkspaceFileSystemError("NOT_FOUND", "Workspace file not found.");
    }
  }
}

class ObservableModel {
  readonly uri: Monaco.Uri;
  readonly languageId: string;
  private text: string;
  private versionId = 1;
  private disposed = false;
  private readonly contentListeners = new Set<ContentListener>();
  private readonly disposeListeners = new Set<DisposeListener>();

  constructor(content: string, languageId: string | undefined, uri: string) {
    this.text = content;
    this.languageId = languageId ?? "plaintext";
    this.uri = { toString: () => uri } as Monaco.Uri;
  }

  getValue(): string {
    return this.text;
  }

  getLanguageId(): string {
    return this.languageId;
  }

  getVersionId(): number {
    return this.versionId;
  }

  onDidChangeContent(listener: ContentListener): Monaco.IDisposable {
    this.contentListeners.add(listener);
    return { dispose: () => this.contentListeners.delete(listener) };
  }

  onWillDispose(listener: DisposeListener): Monaco.IDisposable {
    this.disposeListeners.add(listener);
    return { dispose: () => this.disposeListeners.delete(listener) };
  }

  edit(content: string): void {
    const previous = this.text;
    this.text = content;
    this.versionId += 1;
    this.emitContent(previous, content);
  }

  setValue(content: string): void {
    const previous = this.text;
    this.text = content;
    this.versionId += 1;
    this.emitContent(previous, content);
  }

  /** Delivers a late event to every listener retained by the fake resource. */
  emitStaleContent(content: string): void {
    const previous = this.text;
    this.text = content;
    this.versionId += 1;
    this.emitContent(previous, content);
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const listener of this.disposeListeners) {
      listener();
    }
  }

  private emitContent(previous: string, content: string): void {
    const event = {
      changes: [
        {
          range: {} as Monaco.IRange,
          rangeOffset: 0,
          rangeLength: previous.length,
          text: content,
        },
      ],
      eol: "\n",
      versionId: this.versionId,
      isUndoing: false,
      isRedoing: false,
      isFlush: false,
      isEolChange: false,
      detailedReasonsChangeLengths: [content.length],
    } as Monaco.editor.IModelContentChangedEvent;
    for (const listener of this.contentListeners) {
      listener(event);
    }
  }
}

class ObservableModelService implements WorkspaceModelService {
  readonly models: ObservableModel[] = [];

  createModel(
    content: string,
    languageId: string | undefined,
    uri: string,
  ): Monaco.editor.ITextModel {
    const model = new ObservableModel(content, languageId, uri);
    this.models.push(model);
    return model as unknown as Monaco.editor.ITextModel;
  }
}

class ObservableSyntaxBinding implements WorkspaceSyntaxBinding {
  disposed = false;
  disposeCount = 0;
  staleResultsApplied = 0;
  liveResultsApplied = 0;

  emitResult(): void {
    if (this.disposed) {
      return;
    }
    this.liveResultsApplied += 1;
  }

  emitStaleResult(): void {
    if (!this.disposed) {
      this.staleResultsApplied += 1;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.disposeCount += 1;
  }
}

interface Context {
  fileSystem: StatefulWorkspaceFileSystem;
  modelService: ObservableModelService;
  syntaxBindings: ObservableSyntaxBinding[];
  manager: WorkspaceDocumentManager;
}

function createContext(files: Record<string, string>): Context {
  const fileSystem = new StatefulWorkspaceFileSystem(files);
  const modelService = new ObservableModelService();
  const syntaxBindings: ObservableSyntaxBinding[] = [];
  const manager = new WorkspaceDocumentManager({
    fileSystem,
    modelService,
    createSyntaxBinding: () => {
      const binding = new ObservableSyntaxBinding();
      syntaxBindings.push(binding);
      return binding;
    },
  });
  return { fileSystem, modelService, syntaxBindings, manager };
}

function modelOf(document: Awaited<ReturnType<WorkspaceDocumentManager["open"]>>): ObservableModel {
  return document.model as unknown as ObservableModel;
}

function error(
  code: ConstructorParameters<typeof WorkspaceFileSystemError>[0],
): WorkspaceFileSystemError {
  return new WorkspaceFileSystemError(code, `controlled ${code} failure`);
}

async function waitForPendingWrite(fileSystem: StatefulWorkspaceFileSystem): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await Promise.resolve();
    if (fileSystem.pendingWrites.length > 0) {
      return;
    }
  }
  throw new Error("Timed out waiting for deferred write.");
}

async function waitForPendingOperation(pending: Array<() => void>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await Promise.resolve();
    if (pending.length > 0) {
      return;
    }
  }
  throw new Error("Timed out waiting for deferred operation.");
}

function release(pending: Array<() => void>, operation: string): void {
  const resolve = pending.shift();
  if (resolve === undefined) {
    throw new Error(`No deferred ${operation} is pending.`);
  }
  resolve();
}

describe("WorkspaceDocumentManager operation lifecycle", () => {
  it("creates files and directories only after the backend operation succeeds", async () => {
    const { fileSystem, manager } = createContext({ "src/main.ts": "initial" });

    await manager.createFile("src/new.ts");
    await manager.createDirectory("src/new-directory");

    expect(fileSystem.persisted.get("src/new.ts" as WorkspacePath)).toBe("");
    expect(fileSystem.directories.has("src/new-directory" as WorkspacePath)).toBe(true);

    fileSystem.failNextCreateFile = error("IO_ERROR");
    await expect(manager.createFile("src/failure.ts")).rejects.toMatchObject({ code: "IO_ERROR" });
    expect(fileSystem.persisted.has("src/failure.ts" as WorkspacePath)).toBe(false);

    fileSystem.failNextCreateDirectory = error("IO_ERROR");
    await expect(manager.createDirectory("src/failure-directory")).rejects.toMatchObject({
      code: "IO_ERROR",
    });
    expect(fileSystem.directories.has("src/failure-directory" as WorkspacePath)).toBe(false);
  });

  it("renames a clean open file through persisted state and recreates its runtime identity", async () => {
    const { fileSystem, manager, modelService, syntaxBindings } = createContext({
      "src/query.sql": "SELECT 1;",
    });
    const oldDocument = await manager.open("src/query.sql", "sql");
    const oldModel = modelOf(oldDocument);
    const oldBinding = syntaxBindings[0]!;

    const renamed = await manager.rename("src/query.sql", "src/renamed.sql");
    expect(renamed).toBeDefined();
    const newDocument = renamed!;
    const newModel = modelOf(newDocument);
    const newBinding = syntaxBindings[1]!;

    expect(fileSystem.persisted.get("src/query.sql" as WorkspacePath)).toBeUndefined();
    expect(fileSystem.persisted.get("src/renamed.sql" as WorkspacePath)).toBe("SELECT 1;");
    expect(oldDocument.path).toBe("src/query.sql");
    expect(oldDocument.uri).toBe("file:///workspace/src/query.sql");
    expect(newDocument.path).toBe("src/renamed.sql");
    expect(newDocument.uri).toBe("file:///workspace/src/renamed.sql");
    expect(newDocument.model).toBe(newModel);
    expect(newModel).not.toBe(oldModel);
    expect(newModel.getValue()).toBe("SELECT 1;");
    expect(modelService.models).toHaveLength(2);
    expect(oldModel.isDisposed()).toBe(true);
    expect(oldBinding.disposeCount).toBe(1);
    expect(newModel.isDisposed()).toBe(false);
    expect(newBinding.disposeCount).toBe(0);
    expect(manager.getOpenDocument("src/query.sql")).toBeUndefined();
    expect(manager.getOpenDocument("src/renamed.sql")).toBe(newDocument);
    expect(manager.isDirty("src/renamed.sql")).toBe(false);

    oldModel.emitStaleContent("stale old content");
    oldBinding.emitStaleResult();
    newBinding.emitResult();
    expect(manager.isDirty("src/renamed.sql")).toBe(false);
    expect(fileSystem.persisted.get("src/renamed.sql" as WorkspacePath)).toBe("SELECT 1;");
    expect(oldBinding.staleResultsApplied).toBe(0);
    expect(newBinding.liveResultsApplied).toBe(1);

    await manager.close("src/renamed.sql");
    expect(newModel.isDisposed()).toBe(true);
    expect(newBinding.disposeCount).toBe(1);
  });

  it("rejects concurrent edits while rename is pending and preserves the clean snapshot", async () => {
    const { fileSystem, manager } = createContext({ "src/query.sql": "SELECT 1;" });
    const oldDocument = await manager.open("src/query.sql", "sql");
    const oldModel = modelOf(oldDocument);
    fileSystem.deferRenames = true;

    const rename = manager.rename("src/query.sql", "src/renamed.sql");
    await waitForPendingOperation(fileSystem.pendingRenames);
    expect(oldDocument.busy).toBe(true);

    oldModel.edit("UNSAVED EDIT");
    expect(oldModel.getValue()).toBe("SELECT 1;");
    expect(oldDocument.dirty).toBe(false);
    await expect(manager.save("src/query.sql")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manager.close("src/query.sql")).rejects.toMatchObject({ code: "FORBIDDEN" });

    fileSystem.releaseNextRename();
    const renamed = await rename;
    expect(renamed?.model.getValue()).toBe("SELECT 1;");
    expect(renamed?.dirty).toBe(false);
    expect(fileSystem.persisted.get("src/renamed.sql" as WorkspacePath)).toBe("SELECT 1;");
    await manager.close("src/renamed.sql");
  });

  it("rejects create operations overlapping a pending directory mutation", async () => {
    const { fileSystem, manager } = createContext({ "src/existing.ts": "content" });
    fileSystem.deferRenames = true;

    const rename = manager.rename("src", "renamed-src");
    await waitForPendingOperation(fileSystem.pendingRenames);

    await expect(manager.createFile("src/new.ts")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manager.createDirectory("src/new-directory")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(manager.createFile("renamed-src/new.ts")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fileSystem.persisted.has("src/new.ts" as WorkspacePath)).toBe(false);

    fileSystem.releaseNextRename();
    await rename;
    expect(fileSystem.persisted.get("renamed-src/existing.ts" as WorkspacePath)).toBe("content");
  });

  it("deletes a clean open file only after backend success and disposes its resources", async () => {
    const { fileSystem, manager, syntaxBindings } = createContext({ "src/delete.ts": "initial" });
    const document = await manager.open("src/delete.ts", "typescript");
    const model = modelOf(document);
    const binding = syntaxBindings[0]!;

    await manager.delete("src/delete.ts");

    expect(fileSystem.persisted.has("src/delete.ts" as WorkspacePath)).toBe(false);
    expect(manager.getOpenDocument("src/delete.ts")).toBeUndefined();
    expect(model.isDisposed()).toBe(true);
    expect(binding.disposeCount).toBe(1);
    expect(binding.disposed).toBe(true);
    expect(manager.isDirty.bind(manager, "src/delete.ts")).toThrow();

    model.emitStaleContent("late old content");
    binding.emitStaleResult();
    expect(binding.staleResultsApplied).toBe(0);
    expect(fileSystem.writes).toHaveLength(0);
  });

  it("rejects concurrent edits while delete is pending before disposing resources", async () => {
    const { fileSystem, manager, syntaxBindings } = createContext({
      "src/query.sql": "SELECT 1;",
    });
    const document = await manager.open("src/query.sql", "sql");
    const model = modelOf(document);
    fileSystem.deferDeletes = true;

    const deletion = manager.delete("src/query.sql");
    await waitForPendingOperation(fileSystem.pendingDeletes);
    expect(document.busy).toBe(true);
    model.edit("UNSAVED EDIT");

    expect(model.getValue()).toBe("SELECT 1;");
    expect(document.dirty).toBe(false);
    fileSystem.releaseNextDelete();
    await deletion;

    expect(fileSystem.persisted.has("src/query.sql" as WorkspacePath)).toBe(false);
    expect(model.isDisposed()).toBe(true);
    expect(syntaxBindings[0]?.disposed).toBe(true);
    expect(manager.getOpenDocument("src/query.sql")).toBeUndefined();
  });

  it("invalidates a pending open on close and rejects operations over pending paths", async () => {
    const { fileSystem, manager, modelService, syntaxBindings } = createContext({
      "src/query.sql": "SELECT 1;",
    });
    fileSystem.deferReads = true;
    const opening = manager.open("src/query.sql", "sql");
    await waitForPendingOperation(fileSystem.pendingReads);

    await expect(manager.rename("src/query.sql", "src/renamed.sql")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(manager.delete("src/query.sql")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await manager.close("src/query.sql");
    fileSystem.releaseNextRead();

    await expect(opening).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(modelService.models).toHaveLength(0);
    expect(syntaxBindings).toHaveLength(0);
    expect(manager.getOpenDocument("src/query.sql")).toBeUndefined();
  });

  it("treats a pending descendant open as a directory lifecycle guard", async () => {
    const { fileSystem, manager } = createContext({ "src/nested/query.sql": "SELECT 1;" });
    fileSystem.deferReads = true;
    const opening = manager.open("src/nested/query.sql", "sql");
    await waitForPendingOperation(fileSystem.pendingReads);

    await expect(manager.rename("src", "renamed-src")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(manager.delete("src")).rejects.toMatchObject({ code: "FORBIDDEN" });

    await manager.close("src/nested/query.sql");
    fileSystem.releaseNextRead();
    await expect(opening).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects dirty file rename and delete without changing identity or persisted content", async () => {
    const { fileSystem, manager, syntaxBindings } = createContext({ "src/dirty.ts": "initial" });
    const document = await manager.open("src/dirty.ts", "typescript");
    const model = modelOf(document);
    const binding = syntaxBindings[0]!;
    model.edit("unsaved");

    await expect(manager.rename("src/dirty.ts", "src/moved.ts")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(manager.delete("src/dirty.ts")).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(fileSystem.operations).toEqual([]);
    expect(fileSystem.persisted.get("src/dirty.ts" as WorkspacePath)).toBe("initial");
    expect(manager.getOpenDocument("src/dirty.ts")).toBe(document);
    expect(manager.getOpenDocument("src/moved.ts")).toBeUndefined();
    expect(manager.isDirty("src/dirty.ts")).toBe(true);
    expect(model.isDisposed()).toBe(false);
    expect(binding.disposeCount).toBe(0);

    await manager.close("src/dirty.ts");
  });

  it("rejects directory rename and delete when any descendant is open", async () => {
    const { fileSystem, manager, syntaxBindings } = createContext({
      "src/nested/clean.ts": "clean",
      "src/nested/dirty.ts": "dirty",
    });
    const clean = await manager.open("src/nested/clean.ts", "typescript");
    const dirty = await manager.open("src/nested/dirty.ts", "typescript");
    modelOf(dirty).edit("unsaved");

    await expect(manager.rename("src", "renamed")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manager.delete("src")).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(fileSystem.operations).toEqual([]);
    expect(fileSystem.persisted.get("src/nested/clean.ts" as WorkspacePath)).toBe("clean");
    expect(fileSystem.persisted.get("src/nested/dirty.ts" as WorkspacePath)).toBe("dirty");
    expect(manager.getOpenDocument("src/nested/clean.ts")).toBe(clean);
    expect(manager.getOpenDocument("src/nested/dirty.ts")).toBe(dirty);
    expect(manager.isDirty("src/nested/dirty.ts")).toBe(true);
    expect(modelOf(clean).isDisposed()).toBe(false);
    expect(modelOf(dirty).isDisposed()).toBe(false);
    expect(syntaxBindings.every((binding) => binding.disposeCount === 0)).toBe(true);

    await manager.close("src/nested/clean.ts");
    await manager.close("src/nested/dirty.ts");
  });

  it("keeps old identity intact when backend rename fails", async () => {
    const { fileSystem, manager, syntaxBindings } = createContext({ "src/source.ts": "initial" });
    const document = await manager.open("src/source.ts", "typescript");
    const model = modelOf(document);
    const binding = syntaxBindings[0]!;
    fileSystem.failNextRename = error("IO_ERROR");

    await expect(manager.rename("src/source.ts", "src/destination.ts")).rejects.toMatchObject({
      code: "IO_ERROR",
    });

    expect(fileSystem.persisted.get("src/source.ts" as WorkspacePath)).toBe("initial");
    expect(fileSystem.persisted.has("src/destination.ts" as WorkspacePath)).toBe(false);
    expect(manager.getOpenDocument("src/source.ts")).toBe(document);
    expect(manager.getOpenDocument("src/destination.ts")).toBeUndefined();
    expect(manager.isDirty("src/source.ts")).toBe(false);
    expect(model.isDisposed()).toBe(false);
    expect(binding.disposeCount).toBe(0);

    await manager.close("src/source.ts");
  });

  it("keeps old identity intact when backend delete fails", async () => {
    const { fileSystem, manager, syntaxBindings } = createContext({ "src/source.ts": "initial" });
    const document = await manager.open("src/source.ts", "typescript");
    const model = modelOf(document);
    const binding = syntaxBindings[0]!;
    fileSystem.failNextDelete = error("IO_ERROR");

    await expect(manager.delete("src/source.ts")).rejects.toMatchObject({ code: "IO_ERROR" });

    expect(fileSystem.persisted.get("src/source.ts" as WorkspacePath)).toBe("initial");
    expect(manager.getOpenDocument("src/source.ts")).toBe(document);
    expect(manager.isDirty("src/source.ts")).toBe(false);
    expect(model.isDisposed()).toBe(false);
    expect(binding.disposeCount).toBe(0);

    await manager.close("src/source.ts");
  });

  it("closes dirty documents without writing their unsaved overlay", async () => {
    const { fileSystem, manager, syntaxBindings } = createContext({ "src/close.ts": "initial" });
    const document = await manager.open("src/close.ts", "typescript");
    const model = modelOf(document);
    const binding = syntaxBindings[0]!;
    model.edit("unsaved");

    await manager.close("src/close.ts");

    expect(fileSystem.writes).toHaveLength(0);
    expect(fileSystem.persisted.get("src/close.ts" as WorkspacePath)).toBe("initial");
    expect(manager.getOpenDocument("src/close.ts")).toBeUndefined();
    expect(model.isDisposed()).toBe(true);
    expect(binding.disposeCount).toBe(1);
    expect(manager.isDirty.bind(manager, "src/close.ts")).toThrow();
    model.emitStaleContent("ignored after close");
    expect(fileSystem.writes).toHaveLength(0);
  });

  it("guards rename and delete while a save is pending, then permits mutation after settlement", async () => {
    const { fileSystem, manager, syntaxBindings } = createContext({ "src/pending.ts": "initial" });
    const document = await manager.open("src/pending.ts", "typescript");
    const model = modelOf(document);
    const binding = syntaxBindings[0]!;
    model.edit("persist me");
    fileSystem.deferWrites = true;
    const save = manager.save("src/pending.ts");
    await waitForPendingWrite(fileSystem);

    await expect(manager.rename("src/pending.ts", "src/renamed.ts")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(manager.delete("src/pending.ts")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fileSystem.operations).toEqual([]);
    expect(manager.getOpenDocument("src/pending.ts")).toBe(document);
    expect(manager.isDirty("src/pending.ts")).toBe(true);
    expect(model.isDisposed()).toBe(false);
    expect(binding.disposeCount).toBe(0);

    fileSystem.releaseNextWrite();
    await save;
    expect(fileSystem.persisted.get("src/pending.ts" as WorkspacePath)).toBe("persist me");
    expect(manager.isDirty("src/pending.ts")).toBe(false);

    const renamed = await manager.rename("src/pending.ts", "src/renamed.ts");
    expect(renamed?.path).toBe("src/renamed.ts");
    expect(model.isDisposed()).toBe(true);
    expect(binding.disposeCount).toBe(1);
    expect(fileSystem.persisted.get("src/renamed.ts" as WorkspacePath)).toBe("persist me");
    await manager.close("src/renamed.ts");
  });

  it("does not leave a partially created runtime document when syntax creation fails", async () => {
    const fileSystem = new StatefulWorkspaceFileSystem({ "src/failing.ts": "initial" });
    const modelService = new ObservableModelService();
    const syntaxError = new Error("syntax setup failed");
    const manager = new WorkspaceDocumentManager({
      fileSystem,
      modelService,
      createSyntaxBinding: () => {
        throw syntaxError;
      },
    });

    await expect(manager.open("src/failing.ts", "typescript")).rejects.toBe(syntaxError);
    expect(modelService.models).toHaveLength(1);
    expect(modelService.models[0]!.isDisposed()).toBe(true);
    expect(manager.getOpenDocument("src/failing.ts")).toBeUndefined();
    expect(fileSystem.persisted.get("src/failing.ts" as WorkspacePath)).toBe("initial");
  });
});

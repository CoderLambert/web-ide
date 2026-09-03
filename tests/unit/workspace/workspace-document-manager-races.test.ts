import { describe, expect, it } from "vite-plus/test";

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type { WorkspaceModelService } from "../../../src/editor/monaco/workspace-model-service";
import {
  WorkspaceDocumentManager,
  type WorkspaceSyntaxBinding,
} from "../../../src/workspace/workspace-document-manager";
import type { WorkspaceEntry, WorkspaceFileSystem } from "../../../src/workspace/file-system";
import type { WorkspacePath } from "../../../src/workspace/path";

type ContentListener = (event: Monaco.editor.IModelContentChangedEvent) => void;
type DisposeListener = () => void;

interface PendingWrite {
  path: WorkspacePath;
  content: string;
  resolve: () => void;
  reject: (error: unknown) => void;
}

class DeferredWorkspaceFileSystem implements WorkspaceFileSystem {
  readonly writes: Array<{ path: WorkspacePath; content: string }> = [];
  readonly pendingWrites: PendingWrite[] = [];
  readonly readPaths: WorkspacePath[] = [];
  readonly #persisted = new Map<WorkspacePath, string>();

  constructor(initial: Record<WorkspacePath, string>) {
    for (const [path, content] of Object.entries(initial)) {
      this.#persisted.set(path, content);
    }
  }

  get persisted(): ReadonlyMap<WorkspacePath, string> {
    return this.#persisted;
  }

  async list(_path: WorkspacePath): Promise<WorkspaceEntry[]> {
    return [];
  }

  async readFile(path: WorkspacePath): Promise<string> {
    this.readPaths.push(path);
    const content = this.#persisted.get(path);
    if (content === undefined) {
      throw new Error(`Missing test file: ${path}`);
    }
    return content;
  }

  writeFile(path: WorkspacePath, content: string): Promise<void> {
    this.writes.push({ path, content });
    return new Promise<void>((resolve, reject) => {
      this.pendingWrites.push({ path, content, resolve, reject });
    });
  }

  releaseNextWrite(): void {
    const pending = this.pendingWrites.shift();
    if (pending === undefined) {
      throw new Error("No deferred write is pending.");
    }
    this.#persisted.set(pending.path, pending.content);
    pending.resolve();
  }

  rejectNextWrite(error: unknown): void {
    const pending = this.pendingWrites.shift();
    if (pending === undefined) {
      throw new Error("No deferred write is pending.");
    }
    pending.reject(error);
  }

  async createFile(_path: WorkspacePath): Promise<void> {}

  async createDirectory(_path: WorkspacePath): Promise<void> {}

  async rename(_from: WorkspacePath, _to: WorkspacePath): Promise<void> {}

  async delete(_path: WorkspacePath): Promise<void> {}
}

class FakeModel {
  readonly uri: Monaco.Uri;
  text: string;
  readonly languageId: string | undefined;
  versionId = 1;
  disposed = false;
  private readonly contentListeners = new Set<ContentListener>();
  private readonly disposeListeners = new Set<DisposeListener>();

  constructor(content: string, languageId: string | undefined, uri: string) {
    this.text = content;
    this.languageId = languageId;
    this.uri = { toString: () => uri } as Monaco.Uri;
  }

  getValue(): string {
    return this.text;
  }

  getLanguageId(): string {
    return this.languageId ?? "plaintext";
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
    const oldContent = this.text;
    this.text = content;
    this.versionId += 1;
    const event = {
      changes: [
        {
          range: {} as Monaco.IRange,
          rangeOffset: 0,
          rangeLength: oldContent.length,
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
}

class FakeModelService implements WorkspaceModelService {
  readonly models: FakeModel[] = [];

  createModel(
    content: string,
    languageId: string | undefined,
    uri: string,
  ): Monaco.editor.ITextModel {
    const model = new FakeModel(content, languageId, uri);
    this.models.push(model);
    return model as unknown as Monaco.editor.ITextModel;
  }
}

class FakeSyntaxBinding implements WorkspaceSyntaxBinding {
  disposeCount = 0;

  dispose(): void {
    this.disposeCount += 1;
  }
}

const path = "src/query.sql" as WorkspacePath;
const initialContent = "SELECT 1;";
const versionN = "SELECT 2;";
const versionNPlusOne = "SELECT 3;";

interface TestContext {
  fileSystem: DeferredWorkspaceFileSystem;
  manager: WorkspaceDocumentManager;
  modelService: FakeModelService;
  binding: FakeSyntaxBinding;
}

async function createContext(): Promise<
  TestContext & { document: Awaited<ReturnType<WorkspaceDocumentManager["open"]>> }
> {
  const fileSystem = new DeferredWorkspaceFileSystem({ [path]: initialContent });
  const modelService = new FakeModelService();
  const binding = new FakeSyntaxBinding();
  const manager = new WorkspaceDocumentManager({
    fileSystem,
    modelService,
    createSyntaxBinding: () => binding,
  });
  const document = await manager.open(path, "sql");
  return { fileSystem, manager, modelService, binding, document };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForWriteCount(
  fileSystem: DeferredWorkspaceFileSystem,
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await flushMicrotasks();
    if (fileSystem.writes.length >= count) {
      return;
    }
  }
  throw new Error(`Timed out waiting for ${count} deferred writes.`);
}

function modelOf(document: Awaited<ReturnType<WorkspaceDocumentManager["open"]>>): FakeModel {
  return document.model as unknown as FakeModel;
}

describe("WorkspaceDocumentManager save sequencing", () => {
  it("opens from persisted content and marks only model edits dirty", async () => {
    const { fileSystem, manager, modelService, binding, document } = await createContext();
    const model = modelOf(document);

    expect(fileSystem.readPaths).toEqual([path]);
    expect(modelService.models).toHaveLength(1);
    expect(document.uri).toBe("file:///workspace/src/query.sql");
    expect(model.getValue()).toBe(initialContent);
    expect(document.dirty).toBe(false);
    expect(manager.isDirty(path)).toBe(false);
    expect(model.disposed).toBe(false);
    expect(binding.disposeCount).toBe(0);

    model.edit(versionN);

    expect(document.dirty).toBe(true);
    expect(manager.isDirty(path)).toBe(true);
    expect(fileSystem.persisted.get(path)).toBe(initialContent);
    expect(model.disposed).toBe(false);
    expect(binding.disposeCount).toBe(0);

    await manager.close(path);
  });

  it("reuses one active model for the same canonical URI", async () => {
    const { fileSystem, manager, modelService, document } = await createContext();

    const reopenedWhileActive = await manager.open(path, "sql");

    expect(reopenedWhileActive).toBe(document);
    expect(fileSystem.readPaths).toEqual([path]);
    expect(modelService.models).toHaveLength(1);
    await manager.close(path);
  });

  it("keeps dirty after an older save completes following a newer edit", async () => {
    const { fileSystem, manager, binding, document } = await createContext();
    const model = modelOf(document);
    model.edit(versionN);

    const saveN = manager.save(path);
    await waitForWriteCount(fileSystem, 1);
    expect(fileSystem.writes).toEqual([{ path, content: versionN }]);

    model.edit(versionNPlusOne);
    expect(manager.isDirty(path)).toBe(true);

    fileSystem.releaseNextWrite();
    await saveN;

    expect(fileSystem.persisted.get(path)).toBe(versionN);
    expect(document.dirty).toBe(true);
    expect(manager.isDirty(path)).toBe(true);
    expect(model.disposed).toBe(false);
    expect(binding.disposeCount).toBe(0);

    await manager.close(path);
  });

  it("serializes saves so an older write cannot be overtaken by the latest write", async () => {
    const { fileSystem, manager, binding, document } = await createContext();
    const model = modelOf(document);
    model.edit(versionN);
    const saveN = manager.save(path);
    await waitForWriteCount(fileSystem, 1);

    model.edit(versionNPlusOne);
    const saveNPlusOne = manager.save(path);
    await flushMicrotasks();

    expect(fileSystem.writes).toEqual([{ path, content: versionN }]);
    expect(fileSystem.persisted.get(path)).toBe(initialContent);
    expect(manager.isDirty(path)).toBe(true);

    fileSystem.releaseNextWrite();
    await waitForWriteCount(fileSystem, 2);
    expect(fileSystem.writes).toEqual([
      { path, content: versionN },
      { path, content: versionNPlusOne },
    ]);
    expect(fileSystem.persisted.get(path)).toBe(versionN);

    fileSystem.releaseNextWrite();
    await Promise.all([saveN, saveNPlusOne]);

    expect(fileSystem.persisted.get(path)).toBe(versionNPlusOne);
    expect(document.dirty).toBe(false);
    expect(manager.isDirty(path)).toBe(false);
    expect(model.disposed).toBe(false);
    expect(binding.disposeCount).toBe(0);

    await manager.close(path);
  });

  it("continues the save sequence after a rejected write", async () => {
    const { fileSystem, manager, binding, document } = await createContext();
    const model = modelOf(document);
    model.edit(versionN);
    const saveN = manager.save(path);
    await waitForWriteCount(fileSystem, 1);

    model.edit(versionNPlusOne);
    const saveNPlusOne = manager.save(path);
    const failure = new Error("controlled write failure");
    fileSystem.rejectNextWrite(failure);

    await expect(saveN).rejects.toBe(failure);
    await waitForWriteCount(fileSystem, 2);
    expect(fileSystem.writes).toEqual([
      { path, content: versionN },
      { path, content: versionNPlusOne },
    ]);
    expect(fileSystem.persisted.get(path)).toBe(initialContent);
    expect(manager.isDirty(path)).toBe(true);

    fileSystem.releaseNextWrite();
    await saveNPlusOne;

    expect(fileSystem.persisted.get(path)).toBe(versionNPlusOne);
    expect(document.dirty).toBe(false);
    expect(manager.isDirty(path)).toBe(false);
    expect(model.disposed).toBe(false);
    expect(binding.disposeCount).toBe(0);

    await manager.close(path);
  });

  it("drains an already requested save while close disposes the active resources", async () => {
    const { fileSystem, manager, binding, document } = await createContext();
    const model = modelOf(document);
    model.edit(versionN);
    const save = manager.save(path);
    await waitForWriteCount(fileSystem, 1);

    const close = manager.close(path);
    expect(manager.getOpenDocument(path)).toBeUndefined();
    expect(model.disposed).toBe(true);
    expect(binding.disposeCount).toBe(1);

    fileSystem.releaseNextWrite();
    await Promise.all([save, close]);

    expect(fileSystem.persisted.get(path)).toBe(versionN);
    expect(model.disposed).toBe(true);
    expect(binding.disposeCount).toBe(1);
    expect(manager.getOpenDocument(path)).toBeUndefined();
  });

  it("reopens from persisted filesystem content instead of a browser text cache", async () => {
    const { fileSystem, manager, modelService, document } = await createContext();
    const firstModel = modelOf(document);
    firstModel.edit(versionN);
    const save = manager.save(path);
    await waitForWriteCount(fileSystem, 1);
    fileSystem.releaseNextWrite();
    await save;
    await manager.close(path);

    const reopened = await manager.open(path, "sql");

    expect(modelOf(reopened)).not.toBe(firstModel);
    expect(reopened.model.getValue()).toBe(versionN);
    expect(reopened.dirty).toBe(false);
    expect(fileSystem.readPaths).toEqual([path, path]);
    expect(modelService.models).toHaveLength(2);
    await manager.close(path);
  });
});

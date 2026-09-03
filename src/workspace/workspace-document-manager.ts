import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type { WorkspaceModelService } from "../editor/monaco/workspace-model-service";
import { WorkspaceFileSystemError, type WorkspaceFileSystem } from "./file-system";
import { validateWorkspacePath, type WorkspacePath } from "./path";
import { workspaceUriMapper, type WorkspaceUriMapper } from "./uri-mapper";

export interface WorkspaceSyntaxBinding {
  dispose(): void;
}

export type WorkspaceSyntaxBindingFactory = (
  model: Monaco.editor.ITextModel,
) => WorkspaceSyntaxBinding;

export interface WorkspaceDocumentManagerOptions {
  fileSystem: WorkspaceFileSystem;
  modelService: WorkspaceModelService;
  createSyntaxBinding: WorkspaceSyntaxBindingFactory;
  uriMapper?: WorkspaceUriMapper;
}

export interface OpenWorkspaceDocument {
  readonly path: WorkspacePath;
  readonly uri: string;
  readonly model: Monaco.editor.ITextModel;
  readonly dirty: boolean;
  readonly busy: boolean;
}

interface DocumentEntry extends OpenWorkspaceDocument {
  readonly path: WorkspacePath;
  readonly uri: string;
  readonly model: Monaco.editor.ITextModel;
  readonly syntaxBinding: WorkspaceSyntaxBinding;
  readonly disposables: Monaco.IDisposable[];
  saveTail: Promise<void>;
  pendingSaveCount: number;
  dirty: boolean;
  busy: boolean;
  mutationSnapshot: string | undefined;
  mutationError: unknown;
  suppressDirty: boolean;
  closed: boolean;
}

interface OpeningDocument {
  readonly path: WorkspacePath;
  readonly promise: Promise<OpenWorkspaceDocument>;
}

export class WorkspaceDocumentManager {
  readonly #fileSystem: WorkspaceFileSystem;
  readonly #modelService: WorkspaceModelService;
  readonly #createSyntaxBinding: WorkspaceSyntaxBindingFactory;
  readonly #uriMapper: WorkspaceUriMapper;
  readonly #documents = new Map<string, DocumentEntry>();
  readonly #opening = new Map<string, OpeningDocument>();
  readonly #generations = new Map<string, number>();
  readonly #mutatingPaths = new Set<WorkspacePath>();

  constructor(options: WorkspaceDocumentManagerOptions) {
    this.#fileSystem = options.fileSystem;
    this.#modelService = options.modelService;
    this.#createSyntaxBinding = options.createSyntaxBinding;
    this.#uriMapper = options.uriMapper ?? workspaceUriMapper;
  }

  open(path: WorkspacePath, languageId?: string): Promise<OpenWorkspaceDocument> {
    const workspacePath = validateWorkspacePath(path);
    this.rejectMutationConflict(workspacePath);
    const uri = this.#uriMapper.toUri(workspacePath);
    const existing = this.#documents.get(uri);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }

    const pending = this.#opening.get(uri);
    if (pending !== undefined) {
      return pending.promise;
    }

    const generation = this.generationOf(uri);
    let promise: Promise<OpenWorkspaceDocument>;
    promise = this.openDocument(workspacePath, uri, languageId, generation).finally(() => {
      if (this.#opening.get(uri)?.promise === promise) {
        this.#opening.delete(uri);
      }
    });
    this.#opening.set(uri, { path: workspacePath, promise });
    return promise;
  }

  getOpenDocument(path: WorkspacePath): OpenWorkspaceDocument | undefined {
    const uri = this.#uriMapper.toUri(validateWorkspacePath(path));
    return this.#documents.get(uri);
  }

  isDirty(path: WorkspacePath): boolean {
    return this.getEntry(path).dirty;
  }

  save(path: WorkspacePath): Promise<void> {
    const entry = this.getEntry(path);
    if (entry.closed) {
      return Promise.reject(new Error("Cannot save a closed workspace document."));
    }
    if (entry.busy) {
      return Promise.reject(lifecycleError("Cannot save during a workspace operation."));
    }

    const savedVersion = entry.model.getVersionId();
    const savedContent = entry.model.getValue();
    entry.pendingSaveCount += 1;
    const write = entry.saveTail
      .catch(() => undefined)
      .then(() => this.#fileSystem.writeFile(entry.path, savedContent))
      .then(() => {
        if (!entry.closed && entry.model.getVersionId() === savedVersion) {
          entry.dirty = false;
        }
      })
      .finally(() => {
        entry.pendingSaveCount -= 1;
      });

    entry.saveTail = write.catch(() => undefined);
    return write;
  }

  async close(path: WorkspacePath): Promise<void> {
    const workspacePath = validateWorkspacePath(path);
    const uri = this.#uriMapper.toUri(workspacePath);
    const entry = this.#documents.get(uri);
    if (entry === undefined) {
      if (this.#opening.delete(uri)) {
        this.invalidate(uri);
        return;
      }
      throw new Error("Workspace document is not open.");
    }
    if (entry.busy) {
      throw lifecycleError("Cannot close during a workspace operation.");
    }
    this.closeEntry(entry);
    await entry.saveTail;
  }

  async createFile(path: WorkspacePath): Promise<void> {
    const workspacePath = validateWorkspacePath(path);
    this.rejectOpeningPath(workspacePath);
    this.rejectMutationConflict(workspacePath);
    this.#mutatingPaths.add(workspacePath);
    try {
      await this.#fileSystem.createFile(workspacePath);
    } finally {
      this.#mutatingPaths.delete(workspacePath);
    }
  }

  async createDirectory(path: WorkspacePath): Promise<void> {
    const workspacePath = validateWorkspacePath(path);
    this.rejectOpeningPath(workspacePath);
    this.rejectMutationConflict(workspacePath);
    this.#mutatingPaths.add(workspacePath);
    try {
      await this.#fileSystem.createDirectory(workspacePath);
    } finally {
      this.#mutatingPaths.delete(workspacePath);
    }
  }

  async rename(from: WorkspacePath, to: WorkspacePath): Promise<OpenWorkspaceDocument | undefined> {
    const sourcePath = validateWorkspacePath(from);
    const destinationPath = validateWorkspacePath(to);
    const sourceEntry = this.entryFor(sourcePath);

    this.rejectOpenDescendants(sourcePath);
    this.rejectOpeningPath(sourcePath);
    this.rejectMutationConflict(sourcePath, destinationPath);
    if (sourceEntry !== undefined) {
      this.requireCleanAndSettled(sourceEntry, "rename");
    }

    this.#mutatingPaths.add(sourcePath);
    this.#mutatingPaths.add(destinationPath);
    if (sourceEntry !== undefined) {
      this.beginMutation(sourceEntry);
    }
    try {
      await this.#fileSystem.rename(sourcePath, destinationPath);
      this.invalidate(this.#uriMapper.toUri(sourcePath));

      if (sourceEntry === undefined || sourceEntry.closed) {
        return undefined;
      }
      const languageId = sourceEntry.model.getLanguageId();
      this.closeEntry(sourceEntry);
      await sourceEntry.saveTail;
      const reopened = await this.openDocument(
        destinationPath,
        this.#uriMapper.toUri(destinationPath),
        languageId,
        this.generationOf(this.#uriMapper.toUri(destinationPath)),
      );
      if (sourceEntry.mutationError !== undefined) {
        throw lifecycleError("Workspace document edit rollback failed during rename.");
      }
      return reopened;
    } finally {
      if (sourceEntry !== undefined) {
        this.endMutation(sourceEntry);
      }
      this.#mutatingPaths.delete(sourcePath);
      this.#mutatingPaths.delete(destinationPath);
    }
  }

  async delete(path: WorkspacePath): Promise<void> {
    const workspacePath = validateWorkspacePath(path);
    const entry = this.entryFor(workspacePath);

    this.rejectOpenDescendants(workspacePath);
    this.rejectOpeningPath(workspacePath);
    this.rejectMutationConflict(workspacePath);
    if (entry !== undefined) {
      this.requireCleanAndSettled(entry, "delete");
    }

    this.#mutatingPaths.add(workspacePath);
    if (entry !== undefined) {
      this.beginMutation(entry);
    }
    try {
      await this.#fileSystem.delete(workspacePath);
      this.invalidate(this.#uriMapper.toUri(workspacePath));

      if (entry !== undefined && !entry.closed) {
        this.closeEntry(entry);
        await entry.saveTail;
      }
      if (entry?.mutationError !== undefined) {
        throw lifecycleError("Workspace document edit rollback failed during delete.");
      }
    } finally {
      if (entry !== undefined) {
        this.endMutation(entry);
      }
      this.#mutatingPaths.delete(workspacePath);
    }
  }

  private async openDocument(
    path: WorkspacePath,
    uri: string,
    languageId: string | undefined,
    generation: number,
  ): Promise<OpenWorkspaceDocument> {
    const content = await this.#fileSystem.readFile(path);

    if (generation !== this.generationOf(uri)) {
      throw lifecycleError("Workspace document open was invalidated.");
    }

    const raced = this.#documents.get(uri);
    if (raced !== undefined) {
      return raced;
    }

    const model = this.#modelService.createModel(content, languageId, uri);
    let syntaxBinding: WorkspaceSyntaxBinding;
    try {
      syntaxBinding = this.#createSyntaxBinding(model);
    } catch (error) {
      model.dispose();
      throw error;
    }
    const entry: DocumentEntry = {
      path,
      uri,
      model,
      syntaxBinding,
      disposables: [],
      saveTail: Promise.resolve(),
      pendingSaveCount: 0,
      dirty: false,
      busy: false,
      mutationSnapshot: undefined,
      mutationError: undefined,
      suppressDirty: false,
      closed: false,
    };

    entry.disposables.push(
      model.onDidChangeContent(() => {
        if (entry.closed || entry.suppressDirty) {
          return;
        }
        if (entry.busy && entry.mutationSnapshot !== undefined) {
          entry.suppressDirty = true;
          try {
            entry.model.setValue(entry.mutationSnapshot);
          } catch (error) {
            entry.mutationError = error;
            entry.dirty = true;
          } finally {
            entry.suppressDirty = false;
          }
          return;
        }
        entry.dirty = true;
      }),
      model.onWillDispose(() => this.closeEntry(entry, false)),
    );
    this.#documents.set(uri, entry);
    return entry;
  }

  private getEntry(path: WorkspacePath): DocumentEntry {
    const entry = this.entryFor(path);
    if (entry === undefined) {
      throw new Error("Workspace document is not open.");
    }
    return entry;
  }

  private entryFor(path: WorkspacePath): DocumentEntry | undefined {
    const uri = this.#uriMapper.toUri(validateWorkspacePath(path));
    return this.#documents.get(uri);
  }

  private rejectOpenDescendants(path: WorkspacePath): void {
    const prefix = `${path}/`;
    if ([...this.#documents.values()].some((entry) => entry.path.startsWith(prefix))) {
      throw lifecycleError("Workspace directory has open descendants.");
    }
  }

  private rejectOpeningPath(path: WorkspacePath): void {
    const prefix = `${path}/`;
    if (
      [...this.#opening.values()].some(
        (opening) => opening.path === path || opening.path.startsWith(prefix),
      )
    ) {
      throw lifecycleError("Workspace path is still opening.");
    }
  }

  private rejectMutationConflict(...paths: WorkspacePath[]): void {
    if (
      paths.some((path) =>
        [...this.#mutatingPaths].some(
          (mutatingPath) =>
            path === mutatingPath ||
            path.startsWith(`${mutatingPath}/`) ||
            mutatingPath.startsWith(`${path}/`),
        ),
      )
    ) {
      throw lifecycleError("Workspace path has a pending operation.");
    }
  }

  private generationOf(uri: string): number {
    return this.#generations.get(uri) ?? 0;
  }

  private invalidate(uri: string): void {
    this.#generations.set(uri, this.generationOf(uri) + 1);
  }

  private requireCleanAndSettled(entry: DocumentEntry, operation: "rename" | "delete"): void {
    if (entry.dirty) {
      throw lifecycleError(`Cannot ${operation} a dirty workspace document.`);
    }
    if (entry.pendingSaveCount > 0) {
      throw lifecycleError(`Cannot ${operation} a workspace document with a pending save.`);
    }
  }

  private beginMutation(entry: DocumentEntry): void {
    entry.mutationSnapshot = entry.model.getValue();
    entry.mutationError = undefined;
    entry.busy = true;
  }

  private endMutation(entry: DocumentEntry): void {
    entry.busy = false;
    entry.mutationSnapshot = undefined;
    entry.mutationError = undefined;
    entry.suppressDirty = false;
  }

  private closeEntry(entry: DocumentEntry, disposeModel = true): void {
    if (entry.closed) {
      return;
    }
    entry.closed = true;
    for (const disposable of entry.disposables) {
      disposable.dispose();
    }
    entry.disposables.length = 0;
    entry.syntaxBinding.dispose();
    if (disposeModel && !entry.model.isDisposed()) {
      entry.model.dispose();
    }
    this.#documents.delete(entry.uri);
  }
}

function lifecycleError(message: string): WorkspaceFileSystemError {
  return new WorkspaceFileSystemError("FORBIDDEN", message);
}

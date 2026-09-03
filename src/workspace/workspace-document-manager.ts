import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type { WorkspaceModelService } from "../editor/monaco/workspace-model-service";
import type { WorkspaceFileSystem } from "./file-system";
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
}

interface DocumentEntry extends OpenWorkspaceDocument {
  readonly path: WorkspacePath;
  readonly uri: string;
  readonly model: Monaco.editor.ITextModel;
  readonly syntaxBinding: WorkspaceSyntaxBinding;
  readonly disposables: Monaco.IDisposable[];
  saveTail: Promise<void>;
  dirty: boolean;
  closed: boolean;
}

export class WorkspaceDocumentManager {
  readonly #fileSystem: WorkspaceFileSystem;
  readonly #modelService: WorkspaceModelService;
  readonly #createSyntaxBinding: WorkspaceSyntaxBindingFactory;
  readonly #uriMapper: WorkspaceUriMapper;
  readonly #documents = new Map<string, DocumentEntry>();
  readonly #opening = new Map<string, Promise<OpenWorkspaceDocument>>();

  constructor(options: WorkspaceDocumentManagerOptions) {
    this.#fileSystem = options.fileSystem;
    this.#modelService = options.modelService;
    this.#createSyntaxBinding = options.createSyntaxBinding;
    this.#uriMapper = options.uriMapper ?? workspaceUriMapper;
  }

  open(path: WorkspacePath, languageId?: string): Promise<OpenWorkspaceDocument> {
    const workspacePath = validateWorkspacePath(path);
    const uri = this.#uriMapper.toUri(workspacePath);
    const existing = this.#documents.get(uri);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }

    const pending = this.#opening.get(uri);
    if (pending !== undefined) {
      return pending;
    }

    const opening = this.openDocument(workspacePath, uri, languageId).finally(() => {
      this.#opening.delete(uri);
    });
    this.#opening.set(uri, opening);
    return opening;
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

    const savedVersion = entry.model.getVersionId();
    const savedContent = entry.model.getValue();
    const write = entry.saveTail
      .catch(() => undefined)
      .then(() => this.#fileSystem.writeFile(entry.path, savedContent))
      .then(() => {
        if (!entry.closed && entry.model.getVersionId() === savedVersion) {
          entry.dirty = false;
        }
      });

    entry.saveTail = write.catch(() => undefined);
    return write;
  }

  async close(path: WorkspacePath): Promise<void> {
    const entry = this.getEntry(path);
    this.closeEntry(entry);
    await entry.saveTail;
  }

  private async openDocument(
    path: WorkspacePath,
    uri: string,
    languageId: string | undefined,
  ): Promise<OpenWorkspaceDocument> {
    const content = await this.#fileSystem.readFile(path);

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
      dirty: false,
      closed: false,
    };

    entry.disposables.push(
      model.onDidChangeContent(() => {
        if (!entry.closed) {
          entry.dirty = true;
        }
      }),
      model.onWillDispose(() => this.closeEntry(entry, false)),
    );
    this.#documents.set(uri, entry);
    return entry;
  }

  private getEntry(path: WorkspacePath): DocumentEntry {
    const uri = this.#uriMapper.toUri(validateWorkspacePath(path));
    const entry = this.#documents.get(uri);
    if (entry === undefined) {
      throw new Error("Workspace document is not open.");
    }
    return entry;
  }

  private closeEntry(entry: DocumentEntry, disposeModel = true): void {
    if (entry.closed) {
      return;
    }
    entry.closed = true;
    this.#documents.delete(entry.uri);
    for (const disposable of entry.disposables) {
      disposable.dispose();
    }
    entry.disposables.length = 0;
    entry.syntaxBinding.dispose();
    if (disposeModel && !entry.model.isDisposed()) {
      entry.model.dispose();
    }
  }
}

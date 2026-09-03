import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type { WorkspaceModelService } from "../../../src/editor/monaco/workspace-model-service";
import { BackendWorkspaceFileSystem } from "../../../src/server/workspace/backend-workspace-file-system";
import {
  handleWorkspaceApiRequest,
  type WorkspaceApiDependencies,
} from "../../../src/server/workspace/api";
import type { WorkspaceSyntaxBinding } from "../../../src/workspace/workspace-document-manager";
import { WorkspaceDocumentManager } from "../../../src/workspace/workspace-document-manager";
import {
  RemoteWorkspaceFileSystem,
  type WorkspaceFetch,
} from "../../../src/workspace/remote-workspace-file-system";
import { workspaceUriMapper } from "../../../src/workspace/uri-mapper";

type ContentListener = (event: Monaco.editor.IModelContentChangedEvent) => void;
type DisposeListener = () => void;

const workspaceId = "workspace-integration";
const workspacePath = "src/query.sql";
const initialContent = "SELECT 'initial';\n";
const savedContent = "\ufeffSELECT '保存';\r\n-- exact persisted bytes\r\n";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

class BrowserModel {
  readonly uri: Monaco.Uri;
  readonly #contentListeners = new Set<ContentListener>();
  readonly #disposeListeners = new Set<DisposeListener>();
  #content: string;
  #version = 1;
  #disposed = false;

  constructor(
    content: string,
    readonly languageId: string | undefined,
    uri: string,
  ) {
    this.#content = content;
    this.uri = { toString: () => uri } as Monaco.Uri;
  }

  getValue(): string {
    return this.#content;
  }

  getLanguageId(): string {
    return this.languageId ?? "plaintext";
  }

  getVersionId(): number {
    return this.#version;
  }

  onDidChangeContent(listener: ContentListener): Monaco.IDisposable {
    this.#contentListeners.add(listener);
    return { dispose: () => this.#contentListeners.delete(listener) };
  }

  onWillDispose(listener: DisposeListener): Monaco.IDisposable {
    this.#disposeListeners.add(listener);
    return { dispose: () => this.#disposeListeners.delete(listener) };
  }

  edit(content: string): void {
    const previousLength = this.#content.length;
    this.#content = content;
    this.#version += 1;
    const event = {
      changes: [
        {
          range: {} as Monaco.IRange,
          rangeOffset: 0,
          rangeLength: previousLength,
          text: content,
        },
      ],
      eol: "\n",
      versionId: this.#version,
      isUndoing: false,
      isRedoing: false,
      isFlush: false,
      isEolChange: false,
      detailedReasonsChangeLengths: [content.length],
    } as Monaco.editor.IModelContentChangedEvent;
    for (const listener of this.#contentListeners) {
      listener(event);
    }
  }

  isDisposed(): boolean {
    return this.#disposed;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const listener of this.#disposeListeners) {
      listener();
    }
  }
}

class BrowserModelService implements WorkspaceModelService {
  readonly models: BrowserModel[] = [];

  createModel(
    content: string,
    languageId: string | undefined,
    uri: string,
  ): Monaco.editor.ITextModel {
    const model = new BrowserModel(content, languageId, uri);
    this.models.push(model);
    return model as unknown as Monaco.editor.ITextModel;
  }
}

class BrowserSyntaxBinding implements WorkspaceSyntaxBinding {
  dispose(): void {}
}

describe("Backend persisted workspace visibility", () => {
  it("saves the Monaco buffer through Remote/API and reopens only from Backend storage", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "web-ide-w07-workspace-"));
    temporaryRoots.push(workspaceRoot);
    await mkdir(join(workspaceRoot, "src"));
    await writeFile(join(workspaceRoot, workspacePath), initialContent, "utf8");

    const wirePayloads: string[] = [];
    const authorizationCalls: string[] = [];
    const rootResolutionCalls: string[] = [];
    const dependencies: WorkspaceApiDependencies = {
      authorizer: {
        async authorize(requestedWorkspaceId) {
          authorizationCalls.push(requestedWorkspaceId);
        },
      },
      rootResolver: {
        async resolveRoot(requestedWorkspaceId) {
          rootResolutionCalls.push(requestedWorkspaceId);
          return workspaceRoot;
        },
      },
    };
    const apiFetch: WorkspaceFetch = async (input, init) => {
      const url = typeof input === "string" ? new URL(input, "http://workspace.test") : input;
      const request = new Request(url, init);
      wirePayloads.push(await request.clone().text());
      const response = await handleWorkspaceApiRequest(request, dependencies);
      wirePayloads.push(await response.clone().text());
      return response;
    };
    const remote = new RemoteWorkspaceFileSystem(workspaceId, { fetch: apiFetch });
    const modelService = new BrowserModelService();
    const manager = new WorkspaceDocumentManager({
      fileSystem: remote,
      modelService,
      createSyntaxBinding: () => new BrowserSyntaxBinding(),
    });

    const opened = await manager.open(workspacePath, "sql");
    const firstModel = opened.model as unknown as BrowserModel;
    expect(opened.path).toBe(workspacePath);
    expect(opened.uri).toBe(workspaceUriMapper.toUri(workspacePath));
    expect(workspaceUriMapper.fromUri(opened.uri)).toBe(workspacePath);
    expect(firstModel.getValue()).toBe(initialContent);

    firstModel.edit(savedContent);
    expect(opened.dirty).toBe(true);
    await manager.save(workspacePath);
    expect(opened.dirty).toBe(false);

    const backend = new BackendWorkspaceFileSystem(workspaceRoot);
    await expect(backend.readFile(workspacePath)).resolves.toBe(savedContent);
    expect(await readFile(join(workspaceRoot, workspacePath), "utf8")).toBe(savedContent);

    await manager.close(workspacePath);
    expect(firstModel.isDisposed()).toBe(true);
    const reopened = await manager.open(workspacePath, "sql");
    const reopenedModel = reopened.model as unknown as BrowserModel;
    expect(reopenedModel).not.toBe(firstModel);
    expect(reopenedModel.getValue()).toBe(savedContent);
    expect(reopened.uri).toBe("file:///workspace/src/query.sql");
    expect(reopened.dirty).toBe(false);

    await expect(remote.readFile("src/missing.sql")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Workspace entry was not found.",
    });

    expect(authorizationCalls).toEqual([workspaceId, workspaceId, workspaceId, workspaceId]);
    expect(rootResolutionCalls).toEqual([workspaceId, workspaceId, workspaceId, workspaceId]);
    expect(wirePayloads.join("\n")).not.toContain(workspaceRoot);
    expect(wirePayloads).toEqual(
      expect.arrayContaining([
        JSON.stringify({ workspaceId, operation: "readFile", path: workspacePath }),
        JSON.stringify({
          workspaceId,
          operation: "writeFile",
          path: workspacePath,
          content: savedContent,
        }),
      ]),
    );

    await manager.close(workspacePath);
  });
});

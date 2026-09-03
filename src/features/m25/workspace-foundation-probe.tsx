import { useEffect, useRef, useState } from "react";

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import { MonacoWorkspaceModelService } from "../../editor/monaco/workspace-model-service";
import { WorkspaceFileSystemError } from "../../workspace/file-system";
import { RemoteWorkspaceFileSystem } from "../../workspace/remote-workspace-file-system";
import {
  WorkspaceDocumentManager,
  type WorkspaceSyntaxBinding,
} from "../../workspace/workspace-document-manager";
import type { WorkspacePath } from "../../workspace/path";

const WORKSPACE_ID = "workspace-m25-gate";
const INITIAL_PATH = "src/query.sql" as WorkspacePath;
const RENAMED_PATH = "src/renamed.sql" as WorkspacePath;
const VERSION_A = "SELECT '浏览器保存 A';\r\n-- exact content A\r\n";
const VERSION_B = "SELECT 'browser save B';\n-- ordered content B\n";

type ProbeStatus = "disabled" | "loading" | "ready" | "error";

interface ProbeSnapshot {
  status: ProbeStatus;
  open: boolean;
  uri: string;
  content: string;
  dirty: boolean;
  errorCode: string;
  pendingActions: number;
  completedActions: number;
  createdModels: number;
  disposedModels: number;
  createdBindings: number;
  disposedBindings: number;
  filesystemResult: string;
}

function initialSnapshot(enabled: boolean): ProbeSnapshot {
  return {
    status: enabled ? "loading" : "disabled",
    open: false,
    uri: "",
    content: "",
    dirty: false,
    errorCode: "",
    pendingActions: 0,
    completedActions: 0,
    createdModels: 0,
    disposedModels: 0,
    createdBindings: 0,
    disposedBindings: 0,
    filesystemResult: "",
  };
}

let monacoRuntimePromise: Promise<typeof Monaco> | undefined;

function loadMonacoRuntime(): Promise<typeof Monaco> {
  monacoRuntimePromise ??= Promise.all([
    import("monaco-editor/esm/vs/editor/editor.api.js"),
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
  ])
    .then(([monaco, { default: EditorWorker }]) => {
      Object.assign(globalThis, {
        MonacoEnvironment: {
          getWorker: () => new EditorWorker(),
        },
      });
      return monaco;
    })
    .catch((error: unknown) => {
      monacoRuntimePromise = undefined;
      throw error;
    });
  return monacoRuntimePromise;
}

function errorCode(error: unknown): string {
  return error instanceof WorkspaceFileSystemError ? error.code : "UNEXPECTED";
}

export function WorkspaceFoundationProbe() {
  const enabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("m25WorkspaceTest");
  const [snapshot, setSnapshot] = useState(() => initialSnapshot(enabled));
  const managerRef = useRef<WorkspaceDocumentManager | undefined>(undefined);
  const remoteRef = useRef<RemoteWorkspaceFileSystem | undefined>(undefined);
  const pathRef = useRef<WorkspacePath>(INITIAL_PATH);
  const activeRef = useRef(false);

  function updateFromManager(update: Partial<ProbeSnapshot> = {}): void {
    if (!activeRef.current) {
      return;
    }
    const document = managerRef.current?.getOpenDocument(pathRef.current);
    setSnapshot((current) => ({
      ...current,
      open: document !== undefined,
      uri: document?.uri ?? "",
      content: document?.model.getValue() ?? "",
      dirty: document?.dirty ?? false,
      ...update,
    }));
  }

  useEffect(() => {
    if (!enabled) {
      return;
    }
    activeRef.current = true;
    let cancelled = false;

    void loadMonacoRuntime()
      .then((monaco) => {
        if (cancelled) {
          return;
        }
        const monacoModels = new MonacoWorkspaceModelService(monaco);
        const modelService = {
          createModel(content: string, languageId: string | undefined, uri: string) {
            const model = monacoModels.createModel(content, languageId, uri);
            setSnapshot((current) => ({
              ...current,
              createdModels: current.createdModels + 1,
            }));
            model.onWillDispose(() => {
              if (activeRef.current) {
                setSnapshot((current) => ({
                  ...current,
                  disposedModels: current.disposedModels + 1,
                }));
              }
            });
            return model;
          },
        };
        const remote = new RemoteWorkspaceFileSystem(WORKSPACE_ID);
        remoteRef.current = remote;
        managerRef.current = new WorkspaceDocumentManager({
          fileSystem: remote,
          modelService,
          createSyntaxBinding: () => {
            setSnapshot((current) => ({
              ...current,
              createdBindings: current.createdBindings + 1,
            }));
            let disposed = false;
            return {
              dispose() {
                if (!disposed && activeRef.current) {
                  disposed = true;
                  setSnapshot((current) => ({
                    ...current,
                    disposedBindings: current.disposedBindings + 1,
                  }));
                }
              },
            } satisfies WorkspaceSyntaxBinding;
          },
        });
        updateFromManager({ status: "ready" });
      })
      .catch((error: unknown) => {
        updateFromManager({ status: "error", errorCode: errorCode(error) });
      });

    return () => {
      cancelled = true;
      const manager = managerRef.current;
      const document = manager?.getOpenDocument(pathRef.current);
      if (manager !== undefined && document !== undefined) {
        void manager.close(pathRef.current).catch(() => undefined);
      }
      activeRef.current = false;
      managerRef.current = undefined;
      remoteRef.current = undefined;
      pathRef.current = INITIAL_PATH;
    };
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  function manager(): WorkspaceDocumentManager {
    if (managerRef.current === undefined) {
      throw new Error("Workspace probe is not ready.");
    }
    return managerRef.current;
  }

  function remote(): RemoteWorkspaceFileSystem {
    if (remoteRef.current === undefined) {
      throw new Error("Workspace probe is not ready.");
    }
    return remoteRef.current;
  }

  function run(action: () => Promise<void>): void {
    setSnapshot((current) => ({
      ...current,
      errorCode: "",
      pendingActions: current.pendingActions + 1,
    }));
    void action()
      .catch((error: unknown) => {
        updateFromManager({ errorCode: errorCode(error) });
      })
      .finally(() => {
        updateFromManager();
        setSnapshot((current) => ({
          ...current,
          pendingActions: current.pendingActions - 1,
          completedActions: current.completedActions + 1,
        }));
      });
  }

  function edit(content: string): void {
    setSnapshot((current) => ({ ...current, errorCode: "" }));
    manager().getOpenDocument(pathRef.current)?.model.setValue(content);
    updateFromManager();
  }

  return (
    <section
      data-completed-actions={snapshot.completedActions}
      data-content={snapshot.content}
      data-created-bindings={snapshot.createdBindings}
      data-created-models={snapshot.createdModels}
      data-dirty={String(snapshot.dirty)}
      data-disposed-bindings={snapshot.disposedBindings}
      data-disposed-models={snapshot.disposedModels}
      data-error-code={snapshot.errorCode}
      data-filesystem-result={snapshot.filesystemResult}
      data-open={String(snapshot.open)}
      data-pending-actions={snapshot.pendingActions}
      data-testid="m25-workspace-probe"
      data-uri={snapshot.uri}
      style={{ display: "grid", gap: 8, margin: "0 auto", maxWidth: 960, padding: 24 }}
    >
      <h1>M2.5 workspace foundation probe</h1>
      <p data-testid="m25-workspace-state">{snapshot.status}</p>
      <button
        data-testid="m25-open"
        onClick={() => run(async () => void (await manager().open(pathRef.current, "sql")))}
        type="button"
      >
        Open
      </button>
      <button data-testid="m25-edit-a" onClick={() => edit(VERSION_A)} type="button">
        Edit A
      </button>
      <button data-testid="m25-edit-b" onClick={() => edit(VERSION_B)} type="button">
        Edit B
      </button>
      <button
        data-testid="m25-save"
        onClick={() => run(() => manager().save(pathRef.current))}
        type="button"
      >
        Save
      </button>
      <button
        data-testid="m25-close"
        onClick={() => run(() => manager().close(pathRef.current))}
        type="button"
      >
        Close
      </button>
      <button
        data-testid="m25-rename-file"
        onClick={() =>
          run(async () => {
            const destination = pathRef.current === INITIAL_PATH ? RENAMED_PATH : INITIAL_PATH;
            await manager().rename(pathRef.current, destination);
            pathRef.current = destination;
          })
        }
        type="button"
      >
        Rename file
      </button>
      <button
        data-testid="m25-delete-file"
        onClick={() => run(() => manager().delete(pathRef.current))}
        type="button"
      >
        Delete file
      </button>
      <button
        data-testid="m25-rename-directory"
        onClick={() => run(async () => void (await manager().rename("src", "renamed-src")))}
        type="button"
      >
        Rename directory
      </button>
      <button
        data-testid="m25-delete-directory"
        onClick={() => run(() => manager().delete("src"))}
        type="button"
      >
        Delete directory
      </button>
      <button
        data-testid="m25-filesystem-cycle"
        onClick={() =>
          run(async () => {
            const fileSystem = remote();
            await fileSystem.createDirectory("scratch");
            await fileSystem.createFile("scratch/new.txt");
            await fileSystem.writeFile("scratch/new.txt", "workspace operation content");
            if ((await fileSystem.readFile("scratch/new.txt")) !== "workspace operation content") {
              throw new Error("Workspace read/write mismatch.");
            }
            const listed = await fileSystem.list("scratch");
            if (listed.length !== 1 || listed[0]?.path !== "scratch/new.txt") {
              throw new Error("Workspace list mismatch.");
            }
            await fileSystem.rename("scratch/new.txt", "scratch/renamed.txt");
            await fileSystem.delete("scratch/renamed.txt");
            await fileSystem.delete("scratch");
            updateFromManager({ filesystemResult: "workspace operations passed" });
          })
        }
        type="button"
      >
        Filesystem cycle
      </button>
    </section>
  );
}

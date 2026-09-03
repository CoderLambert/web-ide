import { useEffect, useRef, useState } from "react";

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";

import { MonacoWorkspaceModelService } from "@/editor/monaco/workspace-model-service";
import { SqlLabSyntaxRuntime } from "@/features/sql-lab/editor/sql-lab-syntax-runtime";
import { listSqlFiles, nextSqlFileName } from "@/features/sql-lab/editor/sql-lab-workspace";
import { RemoteWorkspaceFileSystem } from "@/workspace/remote-workspace-file-system";
import { WorkspaceDocumentManager } from "@/workspace/workspace-document-manager";
import type { WorkspacePath } from "@/workspace/path";

let monacoRuntimePromise: Promise<typeof Monaco> | undefined;

function loadMonacoRuntime(): Promise<typeof Monaco> {
  monacoRuntimePromise ??= Promise.all([
    import("monaco-editor/esm/vs/editor/editor.api.js"),
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
  ])
    .then(([monaco, { default: EditorWorker }]) => {
      Object.assign(globalThis, {
        MonacoEnvironment: { getWorker: () => new EditorWorker() },
      });
      return monaco;
    })
    .catch((error: unknown) => {
      monacoRuntimePromise = undefined;
      throw error;
    });
  return monacoRuntimePromise;
}

export interface SqlLabEditorProps {
  workspaceId: string;
}

export function SqlLabEditor({ workspaceId }: SqlLabEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<WorkspaceDocumentManager | undefined>(undefined);
  const fileSystemRef = useRef<RemoteWorkspaceFileSystem | undefined>(undefined);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | undefined>(undefined);
  const syntaxRuntimeRef = useRef<SqlLabSyntaxRuntime | undefined>(undefined);
  const activePathRef = useRef<WorkspacePath | undefined>(undefined);
  const modelListenerRef = useRef<Monaco.IDisposable | undefined>(undefined);
  const openFileRef = useRef<(path: WorkspacePath) => Promise<void>>(async () => undefined);
  const [files, setFiles] = useState<WorkspacePath[]>([]);
  const [activePath, setActivePath] = useState<WorkspacePath>();
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    let cancelled = false;
    if (host === null) {
      setState("error");
      setError("SQL editor host is unavailable.");
      return;
    }

    void loadMonacoRuntime()
      .then(async (monaco) => {
        const fileSystem = new RemoteWorkspaceFileSystem(workspaceId);
        const syntaxRuntime = new SqlLabSyntaxRuntime(monaco, {
          onError: (syntaxError) => {
            if (!cancelled) {
              setError(syntaxError instanceof Error ? syntaxError.message : "SQL syntax error.");
            }
          },
        });
        await syntaxRuntime.start();
        if (cancelled) {
          syntaxRuntime.dispose();
          return;
        }
        const manager = new WorkspaceDocumentManager({
          fileSystem,
          modelService: new MonacoWorkspaceModelService(monaco),
          createSyntaxBinding: (model) => syntaxRuntime.bind(model),
        });
        const editor = monaco.editor.create(host, {
          automaticLayout: true,
          minimap: { enabled: false },
          wordWrap: "on",
        });
        managerRef.current = manager;
        fileSystemRef.current = fileSystem;
        editorRef.current = editor;
        syntaxRuntimeRef.current = syntaxRuntime;
        const listed = await listSqlFiles(fileSystem);
        if (cancelled) {
          editor.dispose();
          syntaxRuntime.dispose();
          return;
        }
        setFiles(listed);
        setState("ready");
        if (listed[0] !== undefined) {
          await openFile(listed[0]);
        }
      })
      .catch((initializationError: unknown) => {
        if (!cancelled) {
          setState("error");
          setError(
            initializationError instanceof Error
              ? initializationError.message
              : "SQL Lab failed to initialize.",
          );
        }
      });

    openFileRef.current = openFile;

    return () => {
      cancelled = true;
      openFileRef.current = async () => undefined;
      modelListenerRef.current?.dispose();
      editorRef.current?.setModel(null);
      editorRef.current?.dispose();
      const manager = managerRef.current;
      const path = activePathRef.current;
      if (manager !== undefined && path !== undefined) {
        void manager.close(path).catch(() => undefined);
      }
      syntaxRuntimeRef.current?.dispose();
      managerRef.current = undefined;
      fileSystemRef.current = undefined;
      editorRef.current = undefined;
      syntaxRuntimeRef.current = undefined;
      activePathRef.current = undefined;
    };

    async function openFile(path: WorkspacePath): Promise<void> {
      const manager = managerRef.current;
      const editor = editorRef.current;
      if (manager === undefined || editor === undefined) {
        return;
      }
      const currentPath = activePathRef.current;
      if (currentPath !== undefined && currentPath !== path) {
        const current = manager.getOpenDocument(currentPath);
        if (current?.dirty) {
          setError("Save the active SQL file before opening another file.");
          return;
        }
        modelListenerRef.current?.dispose();
        modelListenerRef.current = undefined;
        editor.setModel(null);
        await manager.close(currentPath);
      }
      const document = await manager.open(path, "sql");
      editor.setModel(document.model);
      modelListenerRef.current?.dispose();
      modelListenerRef.current = document.model.onDidChangeContent(() => {
        setDirty(manager.isDirty(path));
      });
      activePathRef.current = path;
      setActivePath(path);
      setDirty(document.dirty);
      setError("");
    }
  }, [workspaceId]);

  async function refreshFiles(): Promise<void> {
    const fileSystem = fileSystemRef.current;
    if (fileSystem !== undefined) {
      setFiles(await listSqlFiles(fileSystem));
    }
  }

  async function createFile(): Promise<void> {
    const fileSystem = fileSystemRef.current;
    if (fileSystem === undefined) {
      return;
    }
    const path = nextSqlFileName(files);
    try {
      await fileSystem.createFile(path);
      await refreshFiles();
      await openFileRef.current(path);
    } catch (creationError: unknown) {
      setError(
        creationError instanceof Error ? creationError.message : "Unable to create SQL file.",
      );
    }
  }

  async function saveFile(): Promise<void> {
    const path = activePathRef.current;
    const manager = managerRef.current;
    if (path === undefined || manager === undefined) {
      return;
    }
    try {
      await manager.save(path);
      setDirty(manager.isDirty(path));
      setError("");
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save SQL file.");
    }
  }

  return (
    <section data-testid="sql-lab-editor" style={{ display: "grid", gap: 12, padding: 24 }}>
      <div style={{ alignItems: "center", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <strong>SQL Lab</strong>
        <span data-testid="sql-lab-state">{state}</span>
        {activePath !== undefined ? (
          <span>
            {activePath}
            {dirty ? " *" : ""}
          </span>
        ) : null}
        <button data-testid="sql-lab-new" onClick={() => void createFile()} type="button">
          New
        </button>
        <button
          data-testid="sql-lab-save"
          disabled={activePath === undefined || !dirty}
          onClick={() => void saveFile()}
          type="button"
        >
          Save
        </button>
      </div>
      {error !== "" ? (
        <p aria-live="polite" data-testid="sql-lab-error">
          {error}
        </p>
      ) : null}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "220px minmax(0, 1fr)" }}>
        <nav aria-label="SQL files" style={{ display: "grid", gap: 4, alignContent: "start" }}>
          {files.map((path) => (
            <button
              data-active={String(path === activePath)}
              key={path}
              onClick={() => void openFileRef.current(path)}
              type="button"
            >
              {path}
            </button>
          ))}
          {files.length === 0 ? <span>No .sql files</span> : null}
        </nav>
        <div ref={hostRef} style={{ border: "1px solid currentColor", minHeight: 480 }} />
      </div>
    </section>
  );
}

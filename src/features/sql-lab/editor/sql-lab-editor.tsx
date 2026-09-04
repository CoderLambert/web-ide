import { useEffect, useRef, useState } from "react";

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";

import { Button } from "@/components/ui/button";
import { MonacoWorkspaceModelService } from "@/editor/monaco/workspace-model-service";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SqlLabSyntaxRuntime } from "@/features/sql-lab/editor/sql-lab-syntax-runtime";
import {
  createDirectoryLoader,
  isSqlFileEntry,
  listSqlDirectory,
  nextSqlFileName,
} from "@/features/sql-lab/editor/sql-lab-workspace";
import type { DirectoryLoader } from "@/features/sql-lab/editor/sql-lab-workspace";
import { SqlFileExplorer } from "@/features/sql-lab/editor/sql-file-explorer";
import { resolveSqlQuerySource, type SqlQuerySourceMode } from "@/features/sql-lab/query-source";
import { RemoteWorkspaceFileSystem } from "@/workspace/remote-workspace-file-system";
import { WorkspaceDocumentManager } from "@/workspace/workspace-document-manager";
import type { WorkspaceEntry } from "@/workspace/file-system";
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
  onRun?: (mode: SqlQuerySourceMode, sql: string) => Promise<void>;
  onExplain?: (mode: SqlQuerySourceMode, sql: string) => Promise<void>;
  onReset?: () => Promise<void>;
  operationActive?: boolean;
}

export function SqlLabEditor({
  workspaceId,
  onRun,
  onExplain,
  onReset,
  operationActive = false,
}: SqlLabEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<WorkspaceDocumentManager | undefined>(undefined);
  const fileSystemRef = useRef<RemoteWorkspaceFileSystem | undefined>(undefined);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | undefined>(undefined);
  const syntaxRuntimeRef = useRef<SqlLabSyntaxRuntime | undefined>(undefined);
  const activePathRef = useRef<WorkspacePath | undefined>(undefined);
  const modelListenerRef = useRef<Monaco.IDisposable | undefined>(undefined);
  const openFileRef = useRef<(path: WorkspacePath) => Promise<void>>(async () => undefined);
  const loadDirectoryRef = useRef<
    (path: WorkspacePath, force?: boolean) => Promise<WorkspaceEntry[]>
  >(async () => []);
  const directoryLoaderRef = useRef<DirectoryLoader<WorkspaceEntry[]> | undefined>(undefined);
  const directoryEntriesRef = useRef(new Map<string, WorkspaceEntry[]>());
  const mountedRef = useRef(false);
  const creatingFileRef = useRef(false);
  const runQueryRef = useRef<(mode: SqlQuerySourceMode) => Promise<void>>(async () => undefined);
  const explainQueryRef = useRef<(mode: SqlQuerySourceMode) => Promise<void>>(
    async () => undefined,
  );
  const resetRef = useRef<() => Promise<void>>(async () => undefined);
  const onRunRef = useRef<SqlLabEditorProps["onRun"]>(onRun);
  const onExplainRef = useRef<SqlLabEditorProps["onExplain"]>(onExplain);
  const onResetRef = useRef<SqlLabEditorProps["onReset"]>(onReset);
  const [directoryEntries, setDirectoryEntries] = useState(
    () => new Map<string, WorkspaceEntry[]>(),
  );
  const [expandedDirectories, setExpandedDirectories] = useState(() => new Set<string>());
  const [loadingDirectories, setLoadingDirectories] = useState(() => new Set<string>());
  const [activePath, setActivePath] = useState<WorkspacePath>();
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [creatingFile, setCreatingFile] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState("");
  onRunRef.current = onRun;
  onExplainRef.current = onExplain;
  onResetRef.current = onReset;

  useEffect(() => {
    const host = hostRef.current;
    let cancelled = false;
    mountedRef.current = true;
    directoryLoaderRef.current?.clear();
    directoryLoaderRef.current = undefined;
    directoryEntriesRef.current = new Map();
    setDirectoryEntries(new Map());
    setExpandedDirectories(new Set());
    setLoadingDirectories(new Set());
    setActivePath(undefined);
    setDirty(false);
    setState("loading");
    setCreatingFile(false);
    setShowHidden(false);
    setError("");
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
        const directoryLoader = createDirectoryLoader<WorkspaceEntry[]>((path) =>
          listSqlDirectory(fileSystem, path),
        );
        directoryLoaderRef.current = directoryLoader;
        const loadDirectory: (
          path: WorkspacePath,
          force?: boolean,
        ) => Promise<WorkspaceEntry[]> = async (path, force = false) => {
          const listed = await directoryLoader.load(path, force);
          if (!cancelled) {
            const nextEntries = new Map(directoryEntriesRef.current);
            nextEntries.set(path, listed);
            directoryEntriesRef.current = nextEntries;
            setDirectoryEntries(nextEntries);
          }
          return listed;
        };
        loadDirectoryRef.current = loadDirectory;
        const listed = await loadDirectory("");
        if (cancelled) {
          editor.dispose();
          syntaxRuntime.dispose();
          return;
        }
        const firstRootSqlFile = listed.find(isSqlFileEntry);
        if (firstRootSqlFile !== undefined) {
          await openFile(firstRootSqlFile.path);
        }
        if (!cancelled) {
          setState("ready");
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
    runQueryRef.current = runQuery;
    explainQueryRef.current = explainQuery;
    resetRef.current = reset;

    return () => {
      cancelled = true;
      mountedRef.current = false;
      creatingFileRef.current = false;
      directoryLoaderRef.current?.clear();
      directoryLoaderRef.current = undefined;
      openFileRef.current = async () => undefined;
      loadDirectoryRef.current = async () => [];
      runQueryRef.current = async () => undefined;
      explainQueryRef.current = async () => undefined;
      resetRef.current = async () => undefined;
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
      if (cancelled) {
        return;
      }
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
        if (cancelled || managerRef.current !== manager || editorRef.current !== editor) {
          return;
        }
      }
      const document = await manager.open(path, "sql");
      if (cancelled || managerRef.current !== manager || editorRef.current !== editor) {
        await manager.close(path).catch(() => undefined);
        return;
      }
      editor.setModel(document.model);
      modelListenerRef.current?.dispose();
      modelListenerRef.current = document.model.onDidChangeContent(() => {
        if (!cancelled) {
          setDirty(manager.isDirty(path));
        }
      });
      activePathRef.current = path;
      if (!cancelled) {
        setActivePath(path);
        setDirty(document.dirty);
        setError("");
      }
    }

    async function resolveAndInvoke(
      mode: SqlQuerySourceMode,
      callback: ((mode: SqlQuerySourceMode, sql: string) => Promise<void>) | undefined,
      action: string,
    ): Promise<void> {
      const editor = editorRef.current;
      const runtime = syntaxRuntimeRef.current;
      if (editor === undefined || runtime === undefined) {
        return;
      }
      try {
        const sql = await resolveSqlQuerySource(mode, editor, runtime.registry);
        if (cancelled) {
          return;
        }
        if (sql === undefined || sql.trim() === "") {
          setError(`No SQL source is available for ${action} ${mode}.`);
          return;
        }
        if (callback === undefined) {
          setError(`SQL ${action.toLowerCase()} is not configured.`);
          return;
        }
        await callback(mode, sql);
      } catch (runError: unknown) {
        if (!cancelled) {
          setError(runError instanceof Error ? runError.message : "Unable to resolve SQL source.");
        }
      }
    }

    async function runQuery(mode: SqlQuerySourceMode): Promise<void> {
      await resolveAndInvoke(mode, onRunRef.current, "Run");
    }

    async function explainQuery(mode: SqlQuerySourceMode): Promise<void> {
      await resolveAndInvoke(mode, onExplainRef.current, "Explain");
    }

    async function reset(): Promise<void> {
      if (onResetRef.current === undefined) {
        setError("SQL reset is not configured.");
        return;
      }
      try {
        await onResetRef.current();
      } catch (resetError: unknown) {
        if (!cancelled) {
          setError(resetError instanceof Error ? resetError.message : "Unable to reset SQL Lab.");
        }
      }
    }
  }, [workspaceId]);

  async function toggleDirectory(path: WorkspacePath): Promise<void> {
    if (expandedDirectories.has(path)) {
      setExpandedDirectories((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      return;
    }

    setExpandedDirectories((current) => new Set(current).add(path));
    setLoadingDirectories((current) => new Set(current).add(path));
    try {
      await loadDirectoryRef.current(path);
    } catch (directoryError: unknown) {
      if (mountedRef.current) {
        setExpandedDirectories((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
        setError(
          directoryError instanceof Error
            ? directoryError.message
            : "Unable to load workspace directory.",
        );
      }
    } finally {
      if (mountedRef.current) {
        setLoadingDirectories((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    }
  }

  async function createFile(): Promise<void> {
    const fileSystem = fileSystemRef.current;
    if (fileSystem === undefined || state !== "ready" || creatingFile || creatingFileRef.current) {
      return;
    }
    creatingFileRef.current = true;
    setCreatingFile(true);
    const rootFiles = (directoryEntries.get("") ?? [])
      .filter(isSqlFileEntry)
      .map((entry) => entry.path);
    const path = nextSqlFileName(rootFiles);
    try {
      await fileSystem.createFile(path);
      await loadDirectoryRef.current("", true);
      await openFileRef.current(path);
    } catch (creationError: unknown) {
      if (mountedRef.current) {
        setError(
          creationError instanceof Error ? creationError.message : "Unable to create SQL file.",
        );
      }
    } finally {
      creatingFileRef.current = false;
      if (mountedRef.current) {
        setCreatingFile(false);
      }
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
      if (mountedRef.current && managerRef.current === manager) {
        setDirty(manager.isDirty(path));
        setError("");
      }
    } catch (saveError: unknown) {
      if (mountedRef.current) {
        setError(saveError instanceof Error ? saveError.message : "Unable to save SQL file.");
      }
    }
  }

  return (
    <section className="grid min-h-0 gap-3 p-6" data-testid="sql-lab-editor">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-1 text-sm font-semibold">SQL Lab</strong>
        <span
          className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
          data-testid="sql-lab-state"
        >
          {state}
        </span>
        {activePath !== undefined ? (
          <span className="min-w-0 truncate text-sm text-muted-foreground" title={activePath}>
            {activePath}
            {dirty ? " *" : ""}
          </span>
        ) : null}
        <Button
          data-testid="sql-lab-save"
          disabled={activePath === undefined || !dirty}
          onClick={() => void saveFile()}
          size="sm"
          type="button"
          variant="outline"
        >
          Save
        </Button>
        <fieldset
          className="flex items-center gap-1.5 border-0 p-0"
          disabled={operationActive || activePath === undefined || state !== "ready"}
        >
          <legend className="sr-only">Run</legend>
          <Button
            data-testid="sql-lab-run-current"
            onClick={() => void runQueryRef.current("current")}
            size="sm"
            type="button"
          >
            Run Current
          </Button>
          <Button
            data-testid="sql-lab-run-selection"
            onClick={() => void runQueryRef.current("selection")}
            size="sm"
            type="button"
          >
            Run Selection
          </Button>
          <Button
            data-testid="sql-lab-run-all"
            onClick={() => void runQueryRef.current("all")}
            size="sm"
            type="button"
          >
            Run All
          </Button>
        </fieldset>
        <fieldset
          className="flex items-center gap-1.5 border-0 p-0"
          disabled={operationActive || state !== "ready"}
        >
          <legend className="sr-only">Schema</legend>
          <Button
            data-testid="sql-lab-explain-current"
            disabled={activePath === undefined}
            onClick={() => void explainQueryRef.current("current")}
            size="sm"
            type="button"
          >
            Explain Current
          </Button>
          <Button
            data-testid="sql-lab-explain-selection"
            disabled={activePath === undefined}
            onClick={() => void explainQueryRef.current("selection")}
            size="sm"
            type="button"
          >
            Explain Selection
          </Button>
          <Button
            data-testid="sql-lab-reset"
            onClick={() => void resetRef.current()}
            size="sm"
            type="button"
            variant="outline"
          >
            Reset Demo
          </Button>
        </fieldset>
      </div>
      {error !== "" ? (
        <p aria-live="polite" className="m-0 text-sm text-destructive" data-testid="sql-lab-error">
          {error}
        </p>
      ) : null}
      <div
        className="min-h-[30rem] min-w-0 overflow-hidden rounded-lg border bg-background"
        data-testid="sql-lab-resizable"
      >
        <ResizablePanelGroup className="h-full min-h-[30rem] min-w-0" orientation="horizontal">
          <ResizablePanel defaultSize="23" maxSize="36" minSize="16">
            <SqlFileExplorer
              activePath={activePath}
              creatingFile={creatingFile || state !== "ready"}
              entriesByDirectory={directoryEntries}
              expandedDirectories={expandedDirectories}
              loadingDirectories={loadingDirectories}
              onCreateFile={() => void createFile()}
              onOpenFile={(path) => void openFileRef.current(path)}
              onShowHiddenChange={setShowHidden}
              onToggleDirectory={(path) => void toggleDirectory(path)}
              rootEntries={directoryEntries.get("") ?? []}
              rootLoading={state === "loading"}
              showHidden={showHidden}
            />
          </ResizablePanel>
          <ResizableHandle aria-label="Resize SQL files and editor" withHandle />
          <ResizablePanel className="min-w-0" minSize="40">
            <div className="h-full min-h-[30rem] min-w-0 border-l bg-background" ref={hostRef} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </section>
  );
}

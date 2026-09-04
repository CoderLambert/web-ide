import { useEffect, useRef, useState, type ReactNode } from "react";

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";

import { MonacoWorkspaceModelService } from "@/editor/monaco/workspace-model-service";
import { SqlLabSyntaxRuntime } from "@/features/sql-lab/editor/sql-lab-syntax-runtime";
import {
  isSqlFileEntry,
  listSqlDirectory,
  nextSqlFileName,
} from "@/features/sql-lab/editor/sql-lab-workspace";
import { resolveSqlQuerySource, type SqlQuerySourceMode } from "@/features/sql-lab/query-source";
import { RemoteWorkspaceFileSystem } from "@/workspace/remote-workspace-file-system";
import { WorkspaceDocumentManager } from "@/workspace/workspace-document-manager";
import type { WorkspaceEntry } from "@/workspace/file-system";
import type { WorkspacePath } from "@/workspace/path";

let monacoRuntimePromise: Promise<typeof Monaco> | undefined;

type DirectoryLoader = (path: WorkspacePath, force?: boolean) => Promise<WorkspaceEntry[]>;

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
  const loadDirectoryRef = useRef<DirectoryLoader>(async () => []);
  const loadedDirectoriesRef = useRef(new Set<string>());
  const loadingDirectoriesRef = useRef(new Set<string>());
  const directoryEntriesRef = useRef(new Map<string, WorkspaceEntry[]>());
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
  const [activePath, setActivePath] = useState<WorkspacePath>();
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  onRunRef.current = onRun;
  onExplainRef.current = onExplain;
  onResetRef.current = onReset;

  useEffect(() => {
    const host = hostRef.current;
    let cancelled = false;
    loadedDirectoriesRef.current.clear();
    loadingDirectoriesRef.current.clear();
    directoryEntriesRef.current = new Map();
    setDirectoryEntries(new Map());
    setExpandedDirectories(new Set());
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
        const loadDirectory: DirectoryLoader = async (path, force = false) => {
          const cached = directoryEntriesRef.current.get(path);
          if (!force && loadedDirectoriesRef.current.has(path)) {
            return cached ?? [];
          }
          if (loadingDirectoriesRef.current.has(path)) {
            return cached ?? [];
          }

          loadingDirectoriesRef.current.add(path);
          try {
            const listed = await listSqlDirectory(fileSystem, path);
            if (!cancelled) {
              loadedDirectoriesRef.current.add(path);
              const nextEntries = new Map(directoryEntriesRef.current);
              nextEntries.set(path, listed);
              directoryEntriesRef.current = nextEntries;
              setDirectoryEntries(nextEntries);
            }
            return listed;
          } finally {
            loadingDirectoriesRef.current.delete(path);
          }
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
        setState("ready");
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
        setError(runError instanceof Error ? runError.message : "Unable to resolve SQL source.");
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
        setError(resetError instanceof Error ? resetError.message : "Unable to reset SQL Lab.");
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
    try {
      await loadDirectoryRef.current(path);
    } catch (directoryError: unknown) {
      setError(
        directoryError instanceof Error
          ? directoryError.message
          : "Unable to load workspace directory.",
      );
    }
  }

  async function createFile(): Promise<void> {
    const fileSystem = fileSystemRef.current;
    if (fileSystem === undefined) {
      return;
    }
    const rootFiles = (directoryEntries.get("") ?? [])
      .filter(isSqlFileEntry)
      .map((entry) => entry.path);
    const path = nextSqlFileName(rootFiles);
    try {
      await fileSystem.createFile(path);
      await loadDirectoryRef.current("", true);
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

  function renderDirectory(path: WorkspacePath, depth = 0): ReactNode {
    return (directoryEntries.get(path) ?? []).map((entry) => {
      if (entry.kind === "directory") {
        const expanded = expandedDirectories.has(entry.path);
        const label = entry.path.slice(entry.path.lastIndexOf("/") + 1);
        return (
          <div key={entry.path}>
            <button
              aria-expanded={expanded}
              data-testid={`sql-lab-directory-${entry.path}`}
              onClick={() => void toggleDirectory(entry.path)}
              style={{ paddingLeft: depth * 16 }}
              type="button"
            >
              {label}
            </button>
            {expanded ? renderDirectory(entry.path, depth + 1) : null}
          </div>
        );
      }

      return (
        <button
          data-active={String(entry.path === activePath)}
          key={entry.path}
          onClick={() => void openFileRef.current(entry.path)}
          style={{ paddingLeft: depth * 16 }}
          type="button"
        >
          {entry.path}
        </button>
      );
    });
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
        <fieldset
          disabled={operationActive || activePath === undefined || state !== "ready"}
          style={{ border: 0, display: "flex", gap: 8, margin: 0, padding: 0 }}
        >
          <legend>Run</legend>
          <button
            data-testid="sql-lab-run-current"
            onClick={() => void runQueryRef.current("current")}
            type="button"
          >
            Run Current
          </button>
          <button
            data-testid="sql-lab-run-selection"
            onClick={() => void runQueryRef.current("selection")}
            type="button"
          >
            Run Selection
          </button>
          <button
            data-testid="sql-lab-run-all"
            onClick={() => void runQueryRef.current("all")}
            type="button"
          >
            Run All
          </button>
        </fieldset>
        <fieldset
          disabled={operationActive || state !== "ready"}
          style={{ border: 0, display: "flex", gap: 8, margin: 0, padding: 0 }}
        >
          <legend>Schema</legend>
          <button
            data-testid="sql-lab-explain-current"
            disabled={activePath === undefined}
            onClick={() => void explainQueryRef.current("current")}
            type="button"
          >
            Explain Current
          </button>
          <button
            data-testid="sql-lab-explain-selection"
            disabled={activePath === undefined}
            onClick={() => void explainQueryRef.current("selection")}
            type="button"
          >
            Explain Selection
          </button>
          <button data-testid="sql-lab-reset" onClick={() => void resetRef.current()} type="button">
            Reset Demo
          </button>
        </fieldset>
      </div>
      {error !== "" ? (
        <p aria-live="polite" data-testid="sql-lab-error">
          {error}
        </p>
      ) : null}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "220px minmax(0, 1fr)" }}>
        <nav aria-label="SQL files" style={{ display: "grid", gap: 4, alignContent: "start" }}>
          {renderDirectory("")}
          {directoryEntries.get("")?.length === 0 ? <span>No .sql files</span> : null}
        </nav>
        <div ref={hostRef} style={{ border: "1px solid currentColor", minHeight: 480 }} />
      </div>
    </section>
  );
}

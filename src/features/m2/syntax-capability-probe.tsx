import { useEffect, useRef, useState } from "react";

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";

import {
  registerSemanticHighlightProvider,
  HighlightCoordinator,
} from "../../editor/monaco/highlight-coordinator";
import {
  FoldingCoordinator,
  registerFoldingRangeProvider,
} from "../../editor/monaco/folding-provider";
import {
  createSelectionRangeProvider,
  SelectionCoordinator,
} from "../../editor/monaco/selection-provider";
import {
  MonacoSyntaxDocumentBinding,
  type MonacoSyntaxBindingSnapshot,
} from "../../editor/monaco/syntax-document-binding";
import {
  TreeSitterClient,
  TreeSitterClientError,
  type TreeSitterClientRequest,
} from "../../syntax/tree-sitter/client";
import { WorkerSupervisor } from "../../syntax/tree-sitter/worker-supervisor";

const MODEL_URI = "inmemory://m2/syntax-capabilities.sql";
const SESSION_ID = "m2-syntax-capabilities";
const INITIAL_SOURCE = `SELECT lower('😀'), id
FROM users
WHERE id IN (
  SELECT id FROM archive
);
`;

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

interface ProbeResources {
  editor?: Monaco.editor.IStandaloneCodeEditor;
  model?: Monaco.editor.ITextModel;
  binding?: MonacoSyntaxDocumentBinding;
  client?: TreeSitterClient;
  supervisor?: WorkerSupervisor;
  worker?: Worker;
  highlights?: HighlightCoordinator;
  folding?: FoldingCoordinator;
  selection?: SelectionCoordinator;
  selectionProvider?: Monaco.languages.SelectionRangeProvider & { dispose(): void };
  semanticRegistration?: Monaco.IDisposable;
  foldingRegistration?: Monaco.IDisposable;
  selectionRegistration?: Monaco.IDisposable;
}

interface ProbeStatus {
  state: MonacoSyntaxBindingSnapshot["state"] | "loading";
  documentVersion: number | undefined;
  hasErrors: boolean | undefined;
  workerGeneration: number;
  highlightVersion: number | undefined;
  foldingVersion: number | undefined;
  selectionVersion: number | undefined;
  selectionCount: number;
  largeSourceSize: number | undefined;
  highlightRequests: number;
  foldingRequests: number;
  selectionRequests: number;
  capabilityError: string | undefined;
}

function initialStatus(): ProbeStatus {
  return {
    state: "loading",
    documentVersion: undefined,
    hasErrors: undefined,
    workerGeneration: 0,
    highlightVersion: undefined,
    foldingVersion: undefined,
    selectionVersion: undefined,
    selectionCount: 0,
    largeSourceSize: undefined,
    highlightRequests: 0,
    foldingRequests: 0,
    selectionRequests: 0,
    capabilityError: undefined,
  };
}

function disposeResources(resources: ProbeResources): void {
  resources.semanticRegistration?.dispose();
  resources.foldingRegistration?.dispose();
  resources.selectionRegistration?.dispose();
  resources.selectionProvider?.dispose();
  resources.highlights?.dispose();
  resources.folding?.dispose();
  resources.selection?.dispose();
  resources.binding?.dispose();
  resources.client?.dispose();
  resources.supervisor?.terminate();
  resources.editor?.dispose();
  resources.model?.dispose();
}

function largeSql(size: number): string {
  const prefix = "SELECT 1; -- ";
  return `${prefix}${"x".repeat(Math.max(0, size - prefix.length))}`;
}

function reportCapabilityError(
  error: unknown,
  setStatus: (update: (current: ProbeStatus) => ProbeStatus) => void,
): void {
  if (
    error instanceof TreeSitterClientError &&
    ["VERSION_MISMATCH", "WORKER_RESTARTED", "WORKER_FAILED", "CLIENT_DISPOSED"].includes(
      error.code,
    )
  ) {
    return;
  }
  setStatus((current) => ({ ...current, capabilityError: String(error) }));
}

function M2SyntaxCapabilityProbe() {
  const hostRef = useRef<HTMLDivElement>(null);
  const resourcesRef = useRef<ProbeResources>({});
  const [status, setStatus] = useState<ProbeStatus>(initialStatus);
  const recoveryProbeEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("m2RecoveryTest");

  useEffect(() => {
    const host = hostRef.current;
    const resources = resourcesRef.current;
    let cancelled = false;

    if (host === null) {
      setStatus((current) => ({ ...current, state: "error" }));
      return;
    }

    void loadMonacoRuntime()
      .then((monaco) => {
        if (cancelled || !host.isConnected) {
          return;
        }

        resources.model = monaco.editor.createModel(
          INITIAL_SOURCE,
          "sql",
          monaco.Uri.parse(MODEL_URI),
        );
        resources.editor = monaco.editor.create(host, {
          automaticLayout: true,
          minimap: { enabled: false },
          model: resources.model,
        });

        resources.supervisor = new WorkerSupervisor({
          createWorker: (workerGeneration) => {
            const worker = new Worker(
              new URL("../../syntax/tree-sitter/worker/syntax.worker.ts", import.meta.url),
              { name: `m2-syntax-${workerGeneration}`, type: "module" },
            );
            resources.worker = worker;
            worker.postMessage({ type: "initialize", workerGeneration });
            return worker;
          },
          getOpenDocumentSnapshots: () => {
            const binding = resources.binding;
            return binding === undefined || binding.state === "closed"
              ? []
              : [binding.openDocumentSnapshot];
          },
          onWorkerReady: (worker, workerGeneration) => {
            resources.client?.replaceWorker(worker as Worker, workerGeneration);
            setStatus((current) => ({ ...current, workerGeneration }));
          },
          restoreOpenDocuments: async () => {
            const binding = resources.binding;
            if (binding === undefined || binding.state === "closed") {
              return;
            }
            await binding.restore();
          },
        });

        return resources.supervisor.start().then(() => {
          if (
            cancelled ||
            resources.model === undefined ||
            resources.supervisor === undefined ||
            resources.worker === undefined
          ) {
            return;
          }

          resources.client = new TreeSitterClient(
            resources.worker,
            resources.supervisor.workerGeneration,
          );
          const capabilityClient = {
            request: (request: TreeSitterClientRequest) => {
              if (request.type === "GetHighlights") {
                setStatus((current) => ({
                  ...current,
                  highlightRequests: current.highlightRequests + 1,
                }));
              } else if (request.type === "GetFoldingRanges") {
                setStatus((current) => ({
                  ...current,
                  foldingRequests: current.foldingRequests + 1,
                }));
              } else if (request.type === "GetSelectionRanges") {
                setStatus((current) => ({
                  ...current,
                  selectionRequests: current.selectionRequests + 1,
                }));
              }
              return (
                resources.client?.request(request) ??
                Promise.reject(new Error("Client unavailable."))
              );
            },
          };

          resources.highlights = new HighlightCoordinator({
            client: capabilityClient,
            sessionId: SESSION_ID,
            documentUri: MODEL_URI,
            getDocumentVersion: () => resources.model?.getVersionId() ?? 0,
            onError: (error) => reportCapabilityError(error, setStatus),
          });
          resources.folding = new FoldingCoordinator({
            client: capabilityClient,
            sessionId: SESSION_ID,
            documentUri: MODEL_URI,
            getDocumentVersion: () => resources.model?.getVersionId() ?? 0,
            onError: (error) => reportCapabilityError(error, setStatus),
          });
          resources.selection = new SelectionCoordinator({
            client: capabilityClient,
            sessionId: SESSION_ID,
            documentUri: MODEL_URI,
            getDocumentVersion: () => resources.model?.getVersionId() ?? 0,
            onError: (error) => reportCapabilityError(error, setStatus),
          });
          resources.selectionProvider = createSelectionRangeProvider(resources.selection);
          resources.semanticRegistration = registerSemanticHighlightProvider(
            monaco,
            "sql",
            resources.highlights,
          );
          resources.foldingRegistration = registerFoldingRangeProvider(
            monaco,
            "sql",
            resources.folding,
          );
          resources.selectionRegistration = monaco.languages.registerSelectionRangeProvider(
            "sql",
            resources.selectionProvider,
          );

          resources.highlights.onDidChange(() => {
            setStatus((current) => ({
              ...current,
              highlightVersion: resources.highlights?.tokensVersion,
            }));
          });
          resources.folding.onDidChange(() => {
            setStatus((current) => ({
              ...current,
              foldingVersion: resources.folding?.rangesVersion,
            }));
          });

          resources.binding = new MonacoSyntaxDocumentBinding({
            model: resources.model,
            client: resources.client,
            createSessionId: () => SESSION_ID,
            onStateChange: (snapshot) => {
              setStatus((current) => ({
                ...current,
                state: snapshot.state,
                documentVersion: snapshot.documentVersion,
                hasErrors: snapshot.hasErrors,
                workerGeneration: resources.supervisor?.workerGeneration ?? 0,
              }));
            },
            onParseResult: (result) => {
              resources.highlights?.requestLatest(result.documentVersion);
              resources.folding?.requestLatest(result.documentVersion);
            },
          });
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("Failed to initialize the M2 syntax capability probe", error);
          setStatus((current) => ({ ...current, state: "error" }));
        }
      });

    return () => {
      cancelled = true;
      disposeResources(resources);
    };
  }, []);

  const requestSelection = (): void => {
    const resources = resourcesRef.current;
    const model = resources.model;
    const provider = resources.selectionProvider;
    if (model === undefined || provider === undefined || model.isDisposed()) {
      return;
    }

    const offset = Math.max(0, model.getValue().indexOf("id"));
    const position = model.getPositionAt(offset);
    void Promise.resolve(provider.provideSelectionRanges(model, [position], {} as never)).then(
      (ranges) => {
        if (ranges === null || ranges === undefined || model.isDisposed()) {
          return;
        }
        setStatus((current) => ({
          ...current,
          selectionVersion: model.getVersionId(),
          selectionCount: ranges[0]?.length ?? 0,
        }));
      },
    );
  };

  const applyRapidEdits = (): void => {
    const model = resourcesRef.current.model;
    if (model === undefined || model.isDisposed()) {
      return;
    }

    const source = model.getValue();
    for (let index = 0; index < 12; index += 1) {
      model.setValue(`${source} -- rapid edit ${index}\n`);
    }
  };

  const setInvalidSql = (): void => {
    resourcesRef.current.model?.setValue("SELECT (");
  };

  const restoreSql = (): void => {
    resourcesRef.current.model?.setValue(INITIAL_SOURCE);
    setStatus((current) => ({ ...current, largeSourceSize: undefined }));
  };

  const setLargeSource = (size: number): void => {
    resourcesRef.current.model?.setValue(largeSql(size));
    setStatus((current) => ({ ...current, largeSourceSize: size }));
  };

  const injectWorkerFailure = (): void => {
    resourcesRef.current.worker?.dispatchEvent(
      new ErrorEvent("error", { message: "M2 probe-injected Worker failure." }),
    );
  };

  const derivedPending =
    (resourcesRef.current.highlights?.inFlight ? 1 : 0) +
    (resourcesRef.current.folding?.inFlight ? 1 : 0);

  return (
    <main
      data-document-version={status.documentVersion ?? ""}
      data-derived-pending={derivedPending}
      data-capability-error={status.capabilityError ?? ""}
      data-folding-request-count={status.foldingRequests}
      data-folding-version={status.foldingVersion ?? ""}
      data-has-errors={status.hasErrors ?? ""}
      data-highlight-request-count={status.highlightRequests}
      data-highlight-version={status.highlightVersion ?? ""}
      data-large-source-size={status.largeSourceSize ?? ""}
      data-selection-count={status.selectionCount}
      data-selection-request-count={status.selectionRequests}
      data-selection-version={status.selectionVersion ?? ""}
      data-testid="m2-syntax-capabilities"
      data-worker-generation={status.workerGeneration}
      style={{ display: "grid", gap: 12, margin: "0 auto", maxWidth: 960, padding: 24 }}
    >
      <h2>M2 syntax capabilities</h2>
      <p aria-live="polite" data-testid="m2-syntax-state">
        {status.state}
      </p>
      <p>
        version={status.documentVersion ?? "-"} highlights={status.highlightVersion ?? "-"} folds=
        {status.foldingVersion ?? "-"} selection={status.selectionVersion ?? "-"}
      </p>
      <div
        data-testid="m2-syntax-editor-host"
        ref={hostRef}
        style={{ border: "1px solid currentColor", height: 320, width: "100%" }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button data-testid="m2-request-selection" onClick={requestSelection} type="button">
          Request Selection
        </button>
        <button data-testid="m2-rapid-edit" onClick={applyRapidEdits} type="button">
          Apply Rapid Edits
        </button>
        <button data-testid="m2-invalid-sql" onClick={setInvalidSql} type="button">
          Set Invalid SQL
        </button>
        <button data-testid="m2-restore-sql" onClick={restoreSql} type="button">
          Restore SQL
        </button>
        <button
          data-testid="m2-load-100kb"
          onClick={() => setLargeSource(100 * 1024)}
          type="button"
        >
          Load 100KB SQL
        </button>
        <button data-testid="m2-load-1mb" onClick={() => setLargeSource(1024 * 1024)} type="button">
          Load 1MB SQL
        </button>
        {recoveryProbeEnabled ? (
          <button
            data-testid="m2-inject-worker-failure"
            onClick={injectWorkerFailure}
            type="button"
          >
            Inject Worker Failure
          </button>
        ) : null}
      </div>
    </main>
  );
}

export function SyntaxCapabilityProbe() {
  return <M2SyntaxCapabilityProbe />;
}

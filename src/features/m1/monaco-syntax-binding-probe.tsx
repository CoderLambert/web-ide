import { useEffect, useRef, useState } from "react";

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";

import {
  MonacoSyntaxDocumentBinding,
  type MonacoSyntaxBindingSnapshot,
} from "../../editor/monaco/syntax-document-binding";
import { TreeSitterClient } from "../../syntax/tree-sitter/client";
import { WorkerSupervisor } from "../../syntax/tree-sitter/worker-supervisor";

const MODEL_URI = "inmemory://m1/monaco-syntax-binding.sql";
const INITIAL_SOURCE = "SELECT id, name FROM users WHERE active = true;";

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
}

interface ProbeStatus {
  state: MonacoSyntaxBindingSnapshot["state"] | "loading";
  documentVersion: number | undefined;
  parseTimeMs: number | undefined;
  hasErrors: boolean | undefined;
}

function SyntaxBindingProbe() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ProbeStatus>({
    state: "loading",
    documentVersion: undefined,
    parseTimeMs: undefined,
    hasErrors: undefined,
  });

  useEffect(() => {
    const host = hostRef.current;
    const resources: ProbeResources = {};
    let cancelled = false;

    if (!host) {
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

        let activeWorker: Worker | undefined;
        resources.supervisor = new WorkerSupervisor({
          createWorker: (workerGeneration) => {
            const worker = new Worker(
              new URL("../../syntax/tree-sitter/worker/syntax.worker.ts", import.meta.url),
              { name: `m1-syntax-${workerGeneration}`, type: "module" },
            );
            activeWorker = worker;
            worker.postMessage({ type: "initialize", workerGeneration });
            return worker;
          },
        });

        return resources.supervisor.start().then(() => {
          if (cancelled || resources.model === undefined || resources.supervisor === undefined) {
            return;
          }

          if (activeWorker === undefined) {
            throw new Error("Syntax worker was not created.");
          }
          resources.client = new TreeSitterClient(
            activeWorker,
            resources.supervisor.workerGeneration,
          );
          resources.binding = new MonacoSyntaxDocumentBinding({
            model: resources.model,
            client: resources.client,
            onStateChange: (snapshot) => {
              setStatus({
                state: snapshot.state,
                documentVersion: snapshot.documentVersion,
                parseTimeMs: snapshot.parseTimeMs,
                hasErrors: snapshot.hasErrors,
              });
            },
            onError: (error) => {
              console.error("M1 Monaco syntax binding error", error);
            },
          });
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("Failed to initialize the M1 Monaco syntax binding probe", error);
          setStatus((current) => ({ ...current, state: "error" }));
        }
      });

    return () => {
      cancelled = true;
      resources.binding?.dispose();
      resources.client?.dispose();
      resources.supervisor?.terminate();
      resources.editor?.dispose();
      resources.model?.dispose();
    };
  }, []);

  return (
    <main
      data-document-version={status.documentVersion ?? ""}
      data-has-errors={status.hasErrors ?? ""}
      data-parse-time-ms={status.parseTimeMs ?? ""}
      data-testid="m1-monaco-syntax-binding"
      style={{ display: "grid", gap: 12, margin: "0 auto", maxWidth: 960, padding: 24 }}
    >
      <h1>Monaco Syntax Foundation</h1>
      <p aria-live="polite" data-testid="m1-monaco-syntax-state">
        {status.state}
      </p>
      <p>
        version={status.documentVersion ?? "-"} parseTimeMs={status.parseTimeMs ?? "-"} hasErrors=
        {status.hasErrors === undefined ? "-" : String(status.hasErrors)}
      </p>
      <div
        data-testid="m1-monaco-syntax-editor-host"
        ref={hostRef}
        style={{ border: "1px solid currentColor", height: 320, width: "100%" }}
      />
    </main>
  );
}

export function MonacoSyntaxBindingProbe() {
  return <SyntaxBindingProbe />;
}

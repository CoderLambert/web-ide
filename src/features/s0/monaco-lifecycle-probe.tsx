import { useCallback, useEffect, useRef, useState } from "react";

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

const MODEL_URI = "inmemory://s0/monaco-lifecycle.txt";

type ProbeState = "loading" | "ready" | "disposed" | "error";

interface MonacoResources {
  editor?: Monaco.editor.IStandaloneCodeEditor;
  model?: Monaco.editor.ITextModel;
  provider?: Monaco.IDisposable;
}

let monacoRuntimePromise: Promise<typeof Monaco> | undefined;

function loadMonacoRuntime() {
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

function disposeMonacoResources(resources: MonacoResources) {
  resources.provider?.dispose();
  resources.editor?.dispose();
  resources.model?.dispose();
}

interface MonacoProbeProps {
  onCreated: () => void;
  onDisposed: () => void;
  onStateChange: (state: ProbeState) => void;
}

function MonacoProbe({ onCreated, onDisposed, onStateChange }: MonacoProbeProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    let cancelled = false;
    let resources: MonacoResources = {};
    let fullyCreated = false;

    if (!host) {
      onStateChange("error");
      return;
    }

    onStateChange("loading");

    void loadMonacoRuntime()
      .then((monaco) => {
        if (cancelled || !host.isConnected) {
          return;
        }

        resources.model = monaco.editor.createModel(
          "S0 Monaco lifecycle compatibility probe",
          "plaintext",
          monaco.Uri.parse(MODEL_URI),
        );
        resources.provider = monaco.languages.registerHoverProvider("plaintext", {
          provideHover: () => null,
        });
        resources.editor = monaco.editor.create(host, {
          automaticLayout: true,
          minimap: { enabled: false },
          model: resources.model,
        });

        if (cancelled || !host.isConnected) {
          disposeMonacoResources(resources);
          resources = {};
          return;
        }

        fullyCreated = true;
        onCreated();
        onStateChange("ready");
      })
      .catch((error: unknown) => {
        disposeMonacoResources(resources);
        resources = {};

        if (!cancelled) {
          console.error("Failed to initialize the S0 Monaco lifecycle probe", error);
          onStateChange("error");
        }
      });

    return () => {
      cancelled = true;

      disposeMonacoResources(resources);
      resources = {};

      if (fullyCreated) {
        onDisposed();
      }
    };
  }, [onCreated, onDisposed, onStateChange]);

  return (
    <div
      data-testid="monaco-editor-host"
      ref={hostRef}
      style={{ border: "1px solid currentColor", height: 320, width: "100%" }}
    />
  );
}

export function MonacoLifecycleProbe() {
  const [mounted, setMounted] = useState(true);
  const [state, setState] = useState<ProbeState>("loading");
  const [createdCount, setCreatedCount] = useState(0);
  const [disposedCount, setDisposedCount] = useState(0);

  const handleCreated = useCallback(() => {
    setCreatedCount((count) => count + 1);
  }, []);
  const handleDisposed = useCallback(() => {
    setDisposedCount((count) => count + 1);
    setState("disposed");
  }, []);
  const handleStateChange = useCallback((nextState: ProbeState) => {
    setState(nextState);
  }, []);

  return (
    <main
      data-created-count={createdCount}
      data-disposed-count={disposedCount}
      data-testid="monaco-lifecycle-page"
      style={{ display: "grid", gap: 16, margin: "0 auto", maxWidth: 960, padding: 24 }}
    >
      <h1>Monaco lifecycle compatibility</h1>
      <button
        data-testid="monaco-toggle"
        onClick={() => setMounted((current) => !current)}
        type="button"
      >
        {mounted ? "Dispose Monaco" : "Remount Monaco"}
      </button>
      <p aria-live="polite" data-testid="monaco-status">
        {state}
      </p>
      {mounted ? (
        <MonacoProbe
          onCreated={handleCreated}
          onDisposed={handleDisposed}
          onStateChange={handleStateChange}
        />
      ) : null}
    </main>
  );
}

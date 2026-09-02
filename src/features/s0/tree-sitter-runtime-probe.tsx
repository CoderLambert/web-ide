import { useCallback, useEffect, useState } from "react";

type ProbeState = "loading" | "ready" | "terminated" | "error";

const SQL_PARSE_SOURCE = "SELECT id, name FROM users WHERE active = true;";

interface ParseResult {
  hasError: boolean;
  rootType: string;
  treeString: string;
}

interface TreeSitterProbeProps {
  onInitialized: (result: ParseResult) => void;
  onStateChange: (state: ProbeState) => void;
  onTerminated: () => void;
}

function TreeSitterProbe({ onInitialized, onStateChange, onTerminated }: TreeSitterProbeProps) {
  useEffect(() => {
    const worker = new Worker(new URL("./tree-sitter-runtime.worker.ts", import.meta.url), {
      name: "s0-tree-sitter-runtime",
      type: "module",
    });
    let disposed = false;

    onStateChange("loading");

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (disposed) {
        return;
      }

      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === "ready"
      ) {
        worker.postMessage({ source: SQL_PARSE_SOURCE, type: "parse" });
        return;
      }

      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === "parse-result" &&
        "hasError" in event.data &&
        typeof event.data.hasError === "boolean" &&
        "rootType" in event.data &&
        typeof event.data.rootType === "string" &&
        "treeString" in event.data &&
        typeof event.data.treeString === "string"
      ) {
        onInitialized({
          hasError: event.data.hasError,
          rootType: event.data.rootType,
          treeString: event.data.treeString,
        });
        onStateChange("ready");
        return;
      }

      const message =
        typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === "error" &&
        "message" in event.data &&
        typeof event.data.message === "string"
          ? event.data.message
          : "Unexpected Worker response";

      console.error("Failed to initialize the S0 Tree-sitter runtime", message);
      onStateChange("error");
    };
    const handleError = (event: ErrorEvent) => {
      if (disposed) {
        return;
      }

      console.error("Failed to load the S0 Tree-sitter worker", event.message);
      onStateChange("error");
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);

    return () => {
      disposed = true;
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.terminate();
      onTerminated();
    };
  }, [onInitialized, onStateChange, onTerminated]);

  return null;
}

export function TreeSitterRuntimeProbe() {
  const [mounted, setMounted] = useState(true);
  const [state, setState] = useState<ProbeState>("loading");
  const [initializedCount, setInitializedCount] = useState(0);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [terminatedCount, setTerminatedCount] = useState(0);

  const handleInitialized = useCallback((result: ParseResult) => {
    setInitializedCount((count) => count + 1);
    setParseResult(result);
  }, []);
  const handleStateChange = useCallback((nextState: ProbeState) => {
    setState(nextState);
  }, []);
  const handleTerminated = useCallback(() => {
    setTerminatedCount((count) => count + 1);
    setParseResult(null);
    setState("terminated");
  }, []);

  return (
    <section
      data-initialized-count={initializedCount}
      data-terminated-count={terminatedCount}
      data-testid="tree-sitter-runtime-probe"
      style={{ display: "grid", gap: 16, margin: "0 auto", maxWidth: 960, padding: 24 }}
    >
      <h2>Tree-sitter Worker runtime compatibility</h2>
      <button
        data-testid="tree-sitter-toggle"
        onClick={() => setMounted((current) => !current)}
        type="button"
      >
        {mounted ? "Terminate Worker" : "Restart Worker"}
      </button>
      <p aria-live="polite" data-testid="tree-sitter-status">
        {state}
      </p>
      <dl data-testid="tree-sitter-parse-result">
        <dt>SQL source</dt>
        <dd data-testid="tree-sitter-parse-source">{SQL_PARSE_SOURCE}</dd>
        <dt>Root type</dt>
        <dd data-testid="tree-sitter-root-type">{parseResult?.rootType ?? ""}</dd>
        <dt>Has error</dt>
        <dd data-testid="tree-sitter-has-error">
          {parseResult === null ? "" : String(parseResult.hasError)}
        </dd>
        <dt>Tree</dt>
        <dd>
          <pre data-testid="tree-sitter-tree-string">{parseResult?.treeString ?? ""}</pre>
        </dd>
      </dl>
      {mounted ? (
        <TreeSitterProbe
          onInitialized={handleInitialized}
          onStateChange={handleStateChange}
          onTerminated={handleTerminated}
        />
      ) : null}
    </section>
  );
}

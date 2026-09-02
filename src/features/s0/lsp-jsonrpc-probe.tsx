import { useCallback, useEffect, useRef, useState } from "react";

import type { LanguageClientWrapper } from "monaco-languageclient/lcwrapper";

const ECHO_VALUE = "S0-06 WebSocket JSON-RPC round trip";

type ProbeState = "idle" | "connecting" | "ready" | "disconnecting" | "disposed" | "error";

interface ActiveSession {
  languageClient: LanguageClientWrapper;
  webSocket: WebSocket;
}

interface EchoResult {
  connectionId: number;
  value: string;
}

let vscodeApiInitialization: Promise<void> | undefined;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function initializeMonacoVscodeApi() {
  vscodeApiInitialization ??= import("monaco-languageclient/vscodeApiWrapper").then(
    async ({ MonacoVscodeApiWrapper }) => {
      const api = new MonacoVscodeApiWrapper({
        $type: "classic",
        advanced: { loadExtensionServices: false },
        viewsConfig: { $type: "EditorService" },
        workspaceConfig: {
          workspaceProvider: {
            open: async () => false,
            trusted: true,
            workspace: undefined,
          },
        },
      });

      await api.start({ caller: "S0-06 LSP compatibility probe" });
    },
  );

  return vscodeApiInitialization;
}

function createWebSocketUrl() {
  const port = new URLSearchParams(globalThis.location.search).get("s0LspPort") ?? "3010";
  const protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${globalThis.location.hostname}:${port}`;
}

function waitForSocketClose(webSocket: WebSocket) {
  if (webSocket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const handleClose = () => {
      globalThis.clearTimeout(timeout);
      resolve();
    };
    const timeout = globalThis.setTimeout(() => {
      webSocket.removeEventListener("close", handleClose);
      resolve();
    }, 2_000);

    webSocket.addEventListener("close", handleClose, { once: true });
  });
}

async function disposeSession(session: ActiveSession) {
  const closed = waitForSocketClose(session.webSocket);

  await session.languageClient.dispose();

  if (session.webSocket.readyState < WebSocket.CLOSING) {
    session.webSocket.close(1000, "LSP compatibility probe disposed");
  }

  await closed;
}

function isEchoResult(value: unknown): value is EchoResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "connectionId" in value &&
    typeof value.connectionId === "number" &&
    "value" in value &&
    typeof value.value === "string"
  );
}

export function LspJsonRpcProbe() {
  const [state, setState] = useState<ProbeState>("idle");
  const [connectedCount, setConnectedCount] = useState(0);
  const [disposedCount, setDisposedCount] = useState(0);
  const [echoResult, setEchoResult] = useState<EchoResult | null>(null);
  const aliveRef = useRef(true);
  const sessionRef = useRef<ActiveSession | null>(null);

  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;

      if (session !== null) {
        void disposeSession(session);
      }
    };
  }, []);

  const connect = useCallback(async () => {
    if (sessionRef.current !== null) {
      return;
    }

    setState("connecting");
    setEchoResult(null);

    try {
      await initializeMonacoVscodeApi();
      const { LanguageClientWrapper } = await import("monaco-languageclient/lcwrapper");
      const webSocket = new WebSocket(createWebSocketUrl());
      const languageClient = new LanguageClientWrapper({
        clientOptions: {
          documentSelector: [{ language: "s0-sql" }],
          initializationOptions: { probe: "S0-06" },
        },
        connection: { options: { $type: "WebSocketDirect", webSocket } },
        languageId: "s0-sql",
      });
      const session = { languageClient, webSocket };
      sessionRef.current = session;

      await languageClient.start();
      const client = languageClient.getLanguageClient();

      if (client === undefined) {
        throw new Error("Monaco language client was not created");
      }

      const response: unknown = await client.sendRequest("s0/echo", { value: ECHO_VALUE });

      if (!isEchoResult(response)) {
        throw new Error("Mock LSP server returned an invalid echo response");
      }

      if (!aliveRef.current || sessionRef.current !== session) {
        sessionRef.current = null;
        await disposeSession(session);
        return;
      }

      setEchoResult(response);
      setConnectedCount((count) => count + 1);
      setState("ready");
    } catch (error: unknown) {
      const session = sessionRef.current;
      sessionRef.current = null;

      if (session !== null) {
        await disposeSession(session).catch(() => undefined);
      }

      if (aliveRef.current) {
        console.error("Failed to initialize the S0 LSP JSON-RPC probe", error);
        setState("error");
      }
    }
  }, []);

  const disconnect = useCallback(async () => {
    const session = sessionRef.current;

    if (session === null) {
      return;
    }

    sessionRef.current = null;
    setState("disconnecting");

    try {
      await disposeSession(session);

      if (aliveRef.current) {
        setDisposedCount((count) => count + 1);
        setState("disposed");
      }
    } catch (error: unknown) {
      if (aliveRef.current) {
        console.error("Failed to dispose the S0 LSP JSON-RPC probe", errorMessage(error));
        setState("error");
      }
    }
  }, []);

  const busy = state === "connecting" || state === "disconnecting";
  const connected = state === "ready";

  return (
    <section
      data-connected-count={connectedCount}
      data-disposed-count={disposedCount}
      data-testid="lsp-jsonrpc-probe"
      style={{ display: "grid", gap: 16, margin: "0 auto", maxWidth: 960, padding: 24 }}
    >
      <h2>LSP WebSocket JSON-RPC compatibility</h2>
      <button
        data-testid="lsp-toggle"
        disabled={busy}
        onClick={() => void (connected ? disconnect() : connect())}
        type="button"
      >
        {connected ? "Disconnect and dispose" : connectedCount > 0 ? "Reconnect" : "Connect"}
      </button>
      <p aria-live="polite" data-testid="lsp-status">
        {state}
      </p>
      <dl>
        <dt>Echo</dt>
        <dd data-testid="lsp-echo-result">{echoResult?.value ?? ""}</dd>
        <dt>Mock connection</dt>
        <dd data-testid="lsp-connection-id">{echoResult?.connectionId ?? ""}</dd>
      </dl>
    </section>
  );
}

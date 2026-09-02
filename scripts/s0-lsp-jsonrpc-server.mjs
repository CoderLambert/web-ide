import { WebSocket, WebSocketServer } from "ws";

const port = Number.parseInt(process.env.S0_LSP_PORT ?? "3010", 10);

if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error(`Invalid S0_LSP_PORT: ${process.env.S0_LSP_PORT}`);
}

const server = new WebSocketServer({ port });
let nextConnectionId = 1;

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

server.on("connection", (socket) => {
  const connectionId = nextConnectionId;
  nextConnectionId += 1;

  socket.on("message", (data) => {
    let message;

    try {
      message = JSON.parse(data.toString());
    } catch {
      send(socket, {
        error: { code: -32_700, message: "Parse error" },
        id: null,
        jsonrpc: "2.0",
      });
      return;
    }

    if (message.method === "initialize" && message.id !== undefined) {
      send(socket, {
        id: message.id,
        jsonrpc: "2.0",
        result: {
          capabilities: { textDocumentSync: 0 },
          serverInfo: { name: "s0-mock-lsp", version: "1.0.0" },
        },
      });
      return;
    }

    if (message.method === "s0/echo" && message.id !== undefined) {
      send(socket, {
        id: message.id,
        jsonrpc: "2.0",
        result: { connectionId, value: message.params?.value },
      });
      return;
    }

    if (message.method === "shutdown" && message.id !== undefined) {
      send(socket, { id: message.id, jsonrpc: "2.0", result: null });
      return;
    }

    if (message.method === "exit") {
      socket.close(1000, "LSP client disposed");
      return;
    }

    if (message.id !== undefined) {
      send(socket, {
        error: { code: -32_601, message: `Method not found: ${message.method}` },
        id: message.id,
        jsonrpc: "2.0",
      });
    }
  });
});

server.on("listening", () => {
  const address = server.address();

  if (typeof address === "object" && address !== null) {
    console.log(`S0 LSP mock listening on ws://localhost:${address.port}`);
  }
});

function closeServer() {
  for (const client of server.clients) {
    client.close(1001, "Mock server shutting down");
  }

  server.close(() => process.exit(0));
}

process.once("SIGINT", closeServer);
process.once("SIGTERM", closeServer);

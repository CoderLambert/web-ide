import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test } from "playwright/test";

const baseUrl = (process.env.S0_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const serverPath = fileURLToPath(
  new URL("../../scripts/s0-lsp-jsonrpc-server.mjs", import.meta.url),
);

async function navigateClientSide(page: import("playwright/test").Page, pathname: string) {
  await page.evaluate((nextPathname) => {
    const key = crypto.randomUUID();
    const currentIndex = history.state?.__TSR_index ?? 0;

    history.pushState(
      {
        ...history.state,
        __TSR_index: currentIndex + 1,
        __TSR_key: key,
        key,
      },
      "",
      nextPathname,
    );
  }, pathname);
}

let mockServer: ChildProcessWithoutNullStreams;
let mockServerPort: string;

function startMockServer() {
  mockServer = spawn(process.execPath, [serverPath], {
    cwd: workspaceRoot,
    env: { ...process.env, S0_LSP_PORT: "0" },
  });

  return new Promise<string>((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out starting the S0 LSP mock server. stderr: ${stderr}`));
    }, 10_000);

    mockServer.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    mockServer.stdout.on("data", (chunk) => {
      const match = /S0 LSP mock listening on ws:\/\/localhost:(\d+)/.exec(chunk.toString());

      if (match?.[1]) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    mockServer.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`S0 LSP mock server exited early with code ${code}. stderr: ${stderr}`));
    });
  });
}

test.beforeAll(async () => {
  mockServerPort = await startMockServer();
});

test.afterAll(async () => {
  if (mockServer.exitCode === null) {
    mockServer.kill("SIGTERM");
    await new Promise<void>((resolve) => mockServer.once("exit", () => resolve()));
  }
});

test("connects, initializes, reconnects, and disposes the Monaco LSP client", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const sentMethods: string[] = [];
  const receivedMessages: unknown[] = [];
  let closedSockets = 0;
  let socketCount = 0;

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("websocket", (webSocket) => {
    if (new URL(webSocket.url()).port !== mockServerPort) {
      return;
    }

    socketCount += 1;
    webSocket.on("close", () => {
      closedSockets += 1;
    });
    webSocket.on("framesent", ({ payload }) => {
      const message = JSON.parse(payload.toString());

      if (typeof message.method === "string") {
        sentMethods.push(message.method);
      }
    });
    webSocket.on("framereceived", ({ payload }) => {
      receivedMessages.push(JSON.parse(payload.toString()));
    });
  });

  await page.goto(`${baseUrl}/ide?s0LspPort=${mockServerPort}`);
  await expect(page.locator('[data-testid="monaco-status"]')).toHaveText("ready", {
    timeout: 30_000,
  });

  const probe = page.locator('[data-testid="lsp-jsonrpc-probe"]');
  const status = page.locator('[data-testid="lsp-status"]');
  const toggle = page.locator('[data-testid="lsp-toggle"]');

  await expect(status).toHaveText("idle");
  await toggle.click();
  await expect(status).toHaveText("ready", { timeout: 30_000 });
  await expect(page.locator('[data-testid="lsp-echo-result"]')).toHaveText(
    "S0-06 WebSocket JSON-RPC round trip",
  );
  await expect(page.locator('[data-testid="lsp-connection-id"]')).toHaveText("1");
  expect(Number(await probe.getAttribute("data-connected-count"))).toBe(1);

  await toggle.click();
  await expect(status).toHaveText("disposed");
  await expect.poll(() => closedSockets).toBe(1);
  expect(Number(await probe.getAttribute("data-disposed-count"))).toBe(1);

  await toggle.click();
  await expect(status).toHaveText("ready", { timeout: 30_000 });
  await expect(page.locator('[data-testid="lsp-connection-id"]')).toHaveText("2");
  expect(Number(await probe.getAttribute("data-connected-count"))).toBe(2);

  await navigateClientSide(page, "/");
  await expect(page).toHaveURL(`${baseUrl}/`);
  await expect(probe).toHaveCount(0);
  await expect.poll(() => closedSockets).toBe(2);

  expect(socketCount).toBe(2);
  expect(sentMethods.filter((method) => method === "initialize")).toHaveLength(2);
  expect(sentMethods.filter((method) => method === "initialized")).toHaveLength(2);
  expect(sentMethods.filter((method) => method === "s0/echo")).toHaveLength(2);
  expect(sentMethods.filter((method) => method === "shutdown")).toHaveLength(2);
  expect(sentMethods.filter((method) => method === "exit")).toHaveLength(2);
  expect(receivedMessages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        result: expect.objectContaining({
          capabilities: expect.objectContaining({ textDocumentSync: 0 }),
        }),
      }),
      expect.objectContaining({
        result: { connectionId: 1, value: "S0-06 WebSocket JSON-RPC round trip" },
      }),
      expect.objectContaining({
        result: { connectionId: 2, value: "S0-06 WebSocket JSON-RPC round trip" },
      }),
    ]),
  );
  expect(consoleErrors, "console.error messages").toEqual([]);
  expect(pageErrors, "uncaught page errors").toEqual([]);
});

test("retries LSP initialization after the first initialization fails", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const sentMethods: string[] = [];
  let closedSockets = 0;
  let socketCount = 0;

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("websocket", (webSocket) => {
    if (new URL(webSocket.url()).port !== mockServerPort) {
      return;
    }

    socketCount += 1;
    webSocket.on("close", () => {
      closedSockets += 1;
    });
    webSocket.on("framesent", ({ payload }) => {
      const message = JSON.parse(payload.toString());

      if (typeof message.method === "string") {
        sentMethods.push(message.method);
      }
    });
  });

  await page.goto(`${baseUrl}/ide?s0LspPort=${mockServerPort}&s0FailLspInitOnce=1`);
  await expect(page.locator('[data-testid="monaco-status"]')).toHaveText("ready", {
    timeout: 30_000,
  });

  const status = page.locator('[data-testid="lsp-status"]');
  const toggle = page.locator('[data-testid="lsp-toggle"]');

  await toggle.click();
  await expect(status).toHaveText("error");
  expect(socketCount).toBe(0);

  await toggle.click();
  await expect(status).toHaveText("ready", { timeout: 30_000 });
  await expect(page.locator('[data-testid="lsp-echo-result"]')).toHaveText(
    "S0-06 WebSocket JSON-RPC round trip",
  );
  expect(socketCount).toBe(1);
  expect(sentMethods).toEqual(expect.arrayContaining(["initialize", "initialized", "s0/echo"]));

  await toggle.click();
  await expect(status).toHaveText("disposed");
  await expect.poll(() => closedSockets).toBe(1);

  expect(consoleErrors).toHaveLength(1);
  expect(consoleErrors[0]).toContain("Failed to initialize the S0 LSP JSON-RPC probe");
  expect(consoleErrors[0]).toContain("Injected S0 LSP initialization failure");
  expect(pageErrors, "uncaught page errors").toEqual([]);
});

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previewHost = process.env.SQL_LAB_PREVIEW_HOST ?? "127.0.0.1";
const workspaceId = "workspace-m25-gate";
const workspaceToken = randomBytes(24).toString("hex");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${signal ?? `status ${code}`}`));
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, previewHost, resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert(address !== null && typeof address === "object", "Unable to allocate preview port.");
  return address.port;
}

async function waitForPreview(url, preview) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) {
      throw new Error(`Production preview exited with status ${preview.exitCode}.`);
    }
    try {
      const response = await fetch(`${url}/sql-lab`);
      if (response.ok) {
        return;
      }
    } catch {
      // The preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for production preview at ${url}.`);
}

async function stopPreview(preview) {
  if (preview === undefined || preview.exitCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    preview.once("exit", resolve);
    preview.kill("SIGINT");
    setTimeout(() => {
      if (preview.exitCode === null) {
        preview.kill("SIGTERM");
      }
    }, 5_000).unref();
  });
}

const fixtureRoot = await mkdtemp(join(tmpdir(), "web-ide-sql-lab-gate-"));
const workspaceRoot = join(fixtureRoot, "workspace");
const outsideRoot = join(fixtureRoot, "outside");
const databasePath = join(fixtureRoot, "sql-lab.sqlite");
const previewPort = await freePort();
const previewUrl = `http://${previewHost}:${previewPort}`;
const gateEnvironment = {
  ...process.env,
  VITE_WEB_IDE_WORKSPACE_ID: workspaceId,
  WEB_IDE_WORKSPACE_ID: workspaceId,
  WEB_IDE_WORKSPACE_ROOT: workspaceRoot,
  WEB_IDE_WORKSPACE_TOKEN: workspaceToken,
  WEB_IDE_LOCAL_SESSION_BOOTSTRAP: "1",
  WEB_IDE_SQL_LAB_DATABASE_PATH: databasePath,
};
let preview;

try {
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await mkdir(outsideRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "src", "query.sql"), "SELECT 'initial';\n", "utf8");
  await writeFile(join(outsideRoot, "secret.txt"), "outside", "utf8");
  await symlink(join(outsideRoot, "secret.txt"), join(workspaceRoot, "escape-link"));
  await run("pnpm", ["build"], { env: gateEnvironment });

  preview = spawn(
    `${process.cwd()}/node_modules/.bin/vp`,
    ["preview", "--host", previewHost, "--port", String(previewPort)],
    { cwd: process.cwd(), env: gateEnvironment, stdio: "inherit" },
  );
  await waitForPreview(previewUrl, preview);
  const playwrightEnvironment = {
    ...gateEnvironment,
    S0_BASE_URL: previewUrl,
    M25_WORKSPACE_ID: workspaceId,
    M25_WORKSPACE_ROOT: workspaceRoot,
    M25_WORKSPACE_TOKEN: workspaceToken,
    SQL_LAB_WORKSPACE_ID: workspaceId,
    SQL_LAB_WORKSPACE_ROOT: workspaceRoot,
    SQL_LAB_WORKSPACE_TOKEN: workspaceToken,
  };
  await run(
    "pnpm",
    ["exec", "playwright", "test", "tests/s0", "tests/m1", "tests/m2/syntax-capabilities.spec.ts"],
    { env: playwrightEnvironment },
  );
  await run("pnpm", ["exec", "playwright", "test", "tests/sql-lab"], {
    env: playwrightEnvironment,
  });
  await run("pnpm", ["exec", "playwright", "test", "tests/m25"], {
    env: playwrightEnvironment,
  });
  console.log("SQLL-08 production build/preview/API/browser gate PASS");
} finally {
  await stopPreview(preview);
  await rm(fixtureRoot, { recursive: true, force: true });
}

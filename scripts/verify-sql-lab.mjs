import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previewHost = process.env.SQL_LAB_PREVIEW_HOST ?? "127.0.0.1";
const workspaceId = "workspace-m25-gate";
const workspaceToken = randomBytes(24).toString("hex");
const serverBinary = `${process.cwd()}/node_modules/.bin/vp`;
const localRuntimeEnvironmentNames = [
  "WEB_IDE_WORKSPACE_ID",
  "WEB_IDE_WORKSPACE_ROOT",
  "WEB_IDE_WORKSPACE_TOKEN",
  "WEB_IDE_LOCAL_SESSION_BOOTSTRAP",
  "WEB_IDE_SQL_LAB_DATABASE_PATH",
  "VITE_WEB_IDE_WORKSPACE_ID",
];

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

function startServer(args, environment) {
  return spawn(serverBinary, args, {
    cwd: process.cwd(),
    detached: true,
    env: environment,
    stdio: "inherit",
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

async function waitForServer(url, server, label) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`${label} exited with status ${server.exitCode}.`);
    }
    try {
      const response = await fetch(`${url}/sql-lab`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label} at ${url}.`);
}

async function stopPreview(preview) {
  if (preview === undefined || preview.exitCode !== null) {
    return;
  }

  const processGroupId = preview.pid;
  const sendSignal = (signal) => {
    if (processGroupId === undefined) {
      return;
    }
    try {
      process.kill(-processGroupId, signal);
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "ESRCH") {
        throw error;
      }
    }
  };

  await new Promise((resolve) => {
    preview.once("exit", resolve);
    sendSignal("SIGINT");
    setTimeout(() => {
      if (preview.exitCode === null) {
        sendSignal("SIGTERM");
      }
    }, 5_000).unref();
  });
}

function cleanLocalRuntimeEnvironment() {
  const environment = { ...process.env };
  for (const name of localRuntimeEnvironmentNames) {
    delete environment[name];
  }
  return environment;
}

async function runLocalRuntimeSmoke(baseUrl, environment) {
  await run("pnpm", ["exec", "playwright", "test", "tests/sql-lab/local-runtime.spec.ts"], {
    env: { ...environment, S0_BASE_URL: baseUrl },
  });
}

async function runLocalMultiInstanceSmoke(instanceA, instanceB, environment) {
  await run("pnpm", ["exec", "playwright", "test", "tests/sql-lab/local-multi-instance.spec.ts"], {
    env: {
      ...environment,
      S0_BASE_URL: instanceA,
      LOCAL_INSTANCE_A_URL: instanceA,
      LOCAL_INSTANCE_B_URL: instanceB,
    },
  });
}

async function assertProductionFailClosed(url, environment) {
  const request = (cookie) =>
    fetch(`${url}/api/workspace/session`, {
      method: "POST",
      headers: cookie === undefined ? {} : { cookie },
    });

  const absent = await request();
  assert(absent.status === 403, "Production session route accepted an absent cookie.");
  assert(
    absent.headers.get("x-web-ide-workspace-id") === null,
    "Forbidden session response leaked the workspace ID.",
  );

  const wrong = await request("web_ide_workspace_token=wrong-token");
  assert(wrong.status === 403, "Production session route accepted an incorrect cookie.");

  const valid = await request(`web_ide_workspace_token=${environment.WEB_IDE_WORKSPACE_TOKEN}`);
  assert(valid.status === 204, "Production session route rejected the configured cookie.");
  assert(
    valid.headers.get("set-cookie") === null,
    "Production session route set a cookie for an existing session.",
  );
  assert(
    valid.headers.get("x-web-ide-workspace-id") === environment.WEB_IDE_WORKSPACE_ID,
    "Production session route returned the wrong workspace ID.",
  );
}

const cleanEnvironment = cleanLocalRuntimeEnvironment();
let dev;

try {
  const devPort = await freePort();
  const devUrl = `http://${previewHost}:${devPort}`;
  dev = startServer(["dev", "--host", previewHost, "--port", String(devPort)], cleanEnvironment);
  await waitForServer(devUrl, dev, "clean dev server");
  await runLocalRuntimeSmoke(devUrl, cleanEnvironment);
  console.log("SQLL-LOCAL clean dev smoke PASS");
} finally {
  await stopPreview(dev);
}

const fixtureRoot = await mkdtemp(join(tmpdir(), "web-ide-sql-lab-gate-"));
const workspaceRoot = join(fixtureRoot, "workspace");
const outsideRoot = join(fixtureRoot, "outside");
const databasePath = join(fixtureRoot, "sql-lab.sqlite");
const previewPort = await freePort();
const previewUrl = `http://${previewHost}:${previewPort}`;
const gateEnvironment = {
  ...cleanEnvironment,
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
  await run("pnpm", ["build"], { env: cleanEnvironment });

  const cleanPreviewPort = await freePort();
  const cleanPreviewUrl = `http://${previewHost}:${cleanPreviewPort}`;
  preview = startServer(
    ["preview", "--host", previewHost, "--port", String(cleanPreviewPort)],
    cleanEnvironment,
  );
  await waitForServer(cleanPreviewUrl, preview, "clean production preview");
  await runLocalRuntimeSmoke(cleanPreviewUrl, cleanEnvironment);
  await stopPreview(preview);
  preview = undefined;
  console.log("SQLL-LOCAL clean build+preview smoke PASS");

  const multiDevPort = await freePort();
  const multiPreviewPort = await freePort();
  const multiDevUrl = `http://${previewHost}:${multiDevPort}`;
  const multiPreviewUrl = `http://${previewHost}:${multiPreviewPort}`;
  let multiDev;
  let multiPreview;
  try {
    multiDev = startServer(
      ["dev", "--host", previewHost, "--port", String(multiDevPort)],
      cleanEnvironment,
    );
    multiPreview = startServer(
      ["preview", "--host", previewHost, "--port", String(multiPreviewPort)],
      cleanEnvironment,
    );
    await Promise.all([
      waitForServer(multiDevUrl, multiDev, "multi-instance dev server"),
      waitForServer(multiPreviewUrl, multiPreview, "multi-instance preview server"),
    ]);
    await runLocalMultiInstanceSmoke(multiDevUrl, multiPreviewUrl, cleanEnvironment);
  } finally {
    await stopPreview(multiDev);
    await stopPreview(multiPreview);
  }
  console.log("SQLL-LOCAL multi-instance cookie isolation PASS");

  const failClosedEnvironment = { ...gateEnvironment, WEB_IDE_LOCAL_SESSION_BOOTSTRAP: "0" };
  preview = startServer(
    ["preview", "--host", previewHost, "--port", String(previewPort)],
    failClosedEnvironment,
  );
  await waitForServer(previewUrl, preview, "production fail-closed preview");
  await assertProductionFailClosed(previewUrl, failClosedEnvironment);
  await stopPreview(preview);
  preview = undefined;
  console.log("SQLL-LOCAL production fail-closed PASS");

  preview = startServer(
    ["preview", "--host", previewHost, "--port", String(previewPort)],
    gateEnvironment,
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
  await run("pnpm", ["exec", "playwright", "test", "tests/m25"], {
    env: playwrightEnvironment,
  });
  await writeFile(join(workspaceRoot, "src", "query.sql"), "SELECT 'initial';\n", "utf8");
  await run("pnpm", ["exec", "playwright", "test", "tests/sql-lab/sql-lab.spec.ts"], {
    env: playwrightEnvironment,
  });
  console.log("SQLL-08 production build/preview/API/browser gate PASS");
} finally {
  await stopPreview(preview);
  await rm(fixtureRoot, { recursive: true, force: true });
}

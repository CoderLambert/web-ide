import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const previewHost = process.env.M25_PREVIEW_HOST ?? "127.0.0.1";
const previewPort = Number.parseInt(process.env.M25_PREVIEW_PORT ?? "4176", 10);
const previewUrl = `http://${previewHost}:${previewPort}`;

if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65_535) {
  throw new Error(`Invalid M25_PREVIEW_PORT: ${process.env.M25_PREVIEW_PORT}`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

async function waitForPreview(url, previewProcess) {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    if (previewProcess.exitCode !== null) {
      throw new Error(`Production preview exited with status ${previewProcess.exitCode}`);
    }

    try {
      const response = await fetch(`${url}/ide`);
      if (response.ok) {
        return;
      }
    } catch {
      // The preview server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for production preview at ${url}`);
}

async function stopPreview(previewProcess) {
  if (previewProcess === undefined || previewProcess.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => previewProcess.once("exit", resolve));
  previewProcess.kill("SIGINT");
  const forceStop = setTimeout(() => {
    if (previewProcess.exitCode === null) {
      previewProcess.kill("SIGTERM");
    }
  }, 5_000);

  await exited;
  clearTimeout(forceStop);
}

await run("pnpm", ["exec", "tsc", "--noEmit"]);
await run("vp", ["build"]);

const fixtureRoot = await mkdtemp(join(tmpdir(), "web-ide-m25-gate-"));
const workspaceRoot = join(fixtureRoot, "workspace");
const outsideRoot = join(fixtureRoot, "outside");
const workspaceId = "workspace-m25-gate";
const workspaceToken = randomBytes(24).toString("hex");
let preview;

try {
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await mkdir(outsideRoot);
  await writeFile(join(workspaceRoot, "src", "query.sql"), "SELECT 'initial';\n", "utf8");
  await writeFile(join(outsideRoot, "secret.txt"), "outside", "utf8");
  await symlink(join(outsideRoot, "secret.txt"), join(workspaceRoot, "escape-link"));

  const workspaceEnvironment = {
    ...process.env,
    WEB_IDE_WORKSPACE_ID: workspaceId,
    WEB_IDE_WORKSPACE_ROOT: workspaceRoot,
    WEB_IDE_WORKSPACE_TOKEN: workspaceToken,
  };
  preview = spawn(
    `${process.cwd()}/node_modules/.bin/vp`,
    ["preview", "--host", previewHost, "--port", String(previewPort)],
    { stdio: "inherit", env: workspaceEnvironment },
  );

  await waitForPreview(previewUrl, preview);
  await run(
    "pnpm",
    ["exec", "playwright", "test", "tests/s0", "tests/m1", "tests/m2", "tests/m25"],
    {
      env: {
        ...workspaceEnvironment,
        S0_BASE_URL: previewUrl,
        M25_WORKSPACE_ID: workspaceId,
        M25_WORKSPACE_ROOT: workspaceRoot,
        M25_WORKSPACE_TOKEN: workspaceToken,
      },
    },
  );
} finally {
  await stopPreview(preview);
  await rm(fixtureRoot, { recursive: true, force: true });
}

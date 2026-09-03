import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const previewHost = process.env.PHASE_PREVIEW_HOST ?? "127.0.0.1";
const previewPort = Number.parseInt(process.env.PHASE_PREVIEW_PORT ?? "4175", 10);
const previewUrl = `http://${previewHost}:${previewPort}`;
const requestedSuites = process.argv.slice(2);

if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65_535) {
  throw new Error(`Invalid PHASE_PREVIEW_PORT: ${process.env.PHASE_PREVIEW_PORT}`);
}

async function isDirectory(path) {
  try {
    await access(path, constants.F_OK);
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      ...options,
    });

    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`${command} exited with ${signal ?? `status ${code}`}`));
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

    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }

  throw new Error(`Timed out waiting for production preview at ${url}`);
}

async function stopPreview(previewProcess) {
  if (previewProcess.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolveExit) => {
    const resolveOnce = () => {
      previewProcess.off("exit", resolveOnce);
      resolveExit();
    };
    previewProcess.once("exit", resolveOnce);
    if (previewProcess.exitCode !== null) {
      resolveOnce();
    }
  });

  previewProcess.kill("SIGINT");
  const forceStop = setTimeout(() => {
    if (previewProcess.exitCode === null) {
      previewProcess.kill("SIGTERM");
    }
  }, 5_000);

  await exited;
  clearTimeout(forceStop);
}

const suites = [];
for (const suite of requestedSuites) {
  if (await isDirectory(resolve(projectRoot, suite))) {
    suites.push(suite);
  } else {
    console.log(`Skipping unavailable Playwright suite: ${suite}`);
  }
}

if (suites.length === 0) {
  throw new Error("No Playwright suites were found for the production preview gate.");
}

const preview = spawn(
  `${projectRoot}/node_modules/.bin/vp`,
  ["preview", "--host", previewHost, "--port", String(previewPort)],
  { cwd: projectRoot, stdio: "inherit" },
);

try {
  await waitForPreview(previewUrl, preview);
  await run("pnpm", ["exec", "playwright", "test", ...suites], {
    env: { ...process.env, S0_BASE_URL: previewUrl },
  });
} finally {
  await stopPreview(preview);
}

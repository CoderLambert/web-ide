import { spawn } from "node:child_process";

const previewHost = process.env.M2_PREVIEW_HOST ?? "127.0.0.1";
const previewPort = Number.parseInt(process.env.M2_PREVIEW_PORT ?? "4175", 10);
const previewUrl = `http://${previewHost}:${previewPort}`;

if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65_535) {
  throw new Error(`Invalid M2_PREVIEW_PORT: ${process.env.M2_PREVIEW_PORT}`);
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
  if (previewProcess.exitCode !== null) {
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

const preview = spawn(
  `${process.cwd()}/node_modules/.bin/vp`,
  ["preview", "--host", previewHost, "--port", String(previewPort)],
  { stdio: "inherit" },
);

try {
  await waitForPreview(previewUrl, preview);
  await run(
    "pnpm",
    ["exec", "playwright", "test", "tests/s0", "tests/m1", "tests/m2/syntax-capabilities.spec.ts"],
    {
      env: { ...process.env, S0_BASE_URL: previewUrl },
    },
  );
} finally {
  await stopPreview(preview);
}

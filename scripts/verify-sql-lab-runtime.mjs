import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = join(projectRoot, "scripts/sql-lab/runtime-worker.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runWorker(request) {
  const worker = new Worker(workerPath, { type: "module" });
  try {
    const response = await new Promise((resolveResponse, reject) => {
      worker.once("message", resolveResponse);
      worker.once("error", reject);
      worker.postMessage(request);
    });
    if (!response.ok) {
      throw new Error(response.error);
    }
    return response.results;
  } finally {
    await worker.terminate();
  }
}

async function assertRejected(request) {
  const worker = new Worker(workerPath, { type: "module" });
  try {
    const response = await new Promise((resolveResponse, reject) => {
      worker.once("message", resolveResponse);
      worker.once("error", reject);
      worker.postMessage(request);
    });
    assert(!response.ok, `Expected SQL to be rejected: ${request.sql}`);
    assert(
      typeof response.error === "string" && response.error.length > 0,
      `Rejected SQL did not return an error: ${request.sql}`,
    );
  } finally {
    await worker.terminate();
  }
}

async function proveHardTimeout() {
  const worker = new Worker(workerPath, { type: "module" });
  const timeout = setTimeout(() => worker.terminate(), 250);
  try {
    const outcome = await new Promise((resolveOutcome, reject) => {
      worker.once("message", (response) => {
        reject(
          new Error(`Pathological query returned before hard timeout: ${JSON.stringify(response)}`),
        );
      });
      worker.once("error", reject);
      worker.once("exit", (code) => resolveOutcome(code));
      worker.postMessage({
        sql: `WITH RECURSIVE counter(value) AS (
          SELECT 1
          UNION ALL
          SELECT value + 1 FROM counter WHERE value < 1000000000
        ) SELECT sum(value) FROM counter;`,
      });
    });
    assert(outcome !== 0, "Hard-timeout worker unexpectedly exited normally.");
  } finally {
    clearTimeout(timeout);
    if (worker.threadId !== -1) {
      await worker.terminate();
    }
  }
}

async function run(command, args, options = {}) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit", ...options });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${command} exited with ${signal ?? `status ${code}`}`));
      }
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  assert(address !== null && typeof address === "object", "Unable to allocate preview port.");
  return address.port;
}

async function waitFor(url, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Preview exited with status ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The preview is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function stop(child) {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise((resolveStop) => {
    child.once("exit", resolveStop);
    child.kill("SIGINT");
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
    }, 5_000).unref();
  });
}

const fixtureRoot = await mkdtemp(join(tmpdir(), "web-ide-sql-lab-runtime-"));
try {
  const databasePath = join(fixtureRoot, "demo.sqlite");
  const results = await runWorker({
    path: databasePath,
    sql: `CREATE TABLE sample(id INTEGER PRIMARY KEY, label TEXT);
      INSERT INTO sample(label) VALUES ('alpha');
      SELECT CAST(9007199254740993 AS INTEGER) AS integer64, X'CAFE' AS blob_value, NULL AS empty;
      SELECT id, label FROM sample ORDER BY id;`,
  });
  assert(results.length === 4, `Expected four consumed statements, received ${results.length}.`);
  assert(results[2].kind === "rows", "Value query did not return a row result.");
  assert(
    results[2].rows[0][0] === 9007199254740993n,
    "64-bit integer was not preserved as BigInt.",
  );
  assert(results[2].rows[0][1] instanceof Uint8Array, "BLOB was not returned as a byte array.");
  assert(results[2].rows[0][2] === null, "NULL was not preserved.");

  const persisted = await runWorker({
    path: databasePath,
    sql: "SELECT count(*) AS count FROM sample;",
  });
  assert(persisted[0].rows[0][0] === 1n, "File-backed SQLite state was not reusable.");

  await assertRejected({ sql: "ATTACH ':memory:' AS other;" });
  await assertRejected({ sql: "PRAGMA writable_schema = ON;" });
  await assertRejected({ sql: "VACUUM INTO 'escape.sqlite';" });
  await proveHardTimeout();

  await run("vp", ["build"]);
  const port = await freePort();
  const preview = spawn("vp", ["preview", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  try {
    await waitFor(`http://127.0.0.1:${port}/ide`, preview);
  } finally {
    await stop(preview);
  }

  console.log("SQLL-00 node:sqlite runtime/security gate PASS");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

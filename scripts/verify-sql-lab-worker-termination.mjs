import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const childPath = join(projectRoot, "src/server/sql-lab/sqlite-execution.child.ts");
const pathologicalSql = `WITH RECURSIVE counter(value) AS (
  SELECT 1
  UNION ALL
  SELECT value + 1 FROM counter WHERE value < 1000000000
)
SELECT sum(value) FROM counter;`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createChild() {
  return fork(childPath, [], {
    cwd: projectRoot,
    env: {
      ...process.env,
      WEB_IDE_SQL_LAB_CHILD: "1",
    },
    execArgv: process.execArgv.includes("--experimental-strip-types")
      ? process.execArgv
      : [...process.execArgv, "--experimental-strip-types"],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
}

function nextMessage(child) {
  return new Promise((resolveMessage, rejectMessage) => {
    child.once("message", resolveMessage);
    child.once("error", rejectMessage);
  });
}

function nextExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
    child.once("error", rejectExit);
  });
}

async function waitForExit(child, exitPromise) {
  return Promise.race([
    exitPromise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("Timed out waiting for SQL Lab child exit.")),
        5_000,
      ).unref();
    }),
  ]);
}

async function runQuickQuery(databasePath) {
  const child = createChild();
  const exitPromise = nextExit(child);
  try {
    child.send({
      operation: "execute",
      databasePath,
      sql: "SELECT 43 AS answer;",
    });
    const response = await nextMessage(child);
    assert(response.ok === true, `Quick query failed: ${JSON.stringify(response)}`);
    assert(
      response.value.operation === "execute" &&
        response.value.execution.results[0]?.kind === "query" &&
        response.value.execution.results[0].rows[0]?.[0] === 43,
      `Quick query returned an unexpected result: ${JSON.stringify(response)}`,
    );
    const exit = await waitForExit(child, exitPromise);
    assert(
      exit.code === 0 && exit.signal === null,
      `Quick-query child exited abnormally: ${JSON.stringify(exit)}`,
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exitPromise;
    }
  }
}

async function runTimeout(databasePath, attempt) {
  const child = createChild();
  const exitPromise = nextExit(child);
  let receivedResponse = false;
  child.on("message", () => {
    receivedResponse = true;
  });

  try {
    child.send({
      operation: "execute",
      databasePath,
      sql: pathologicalSql,
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    assert(child.kill("SIGKILL"), `Unable to kill SQL Lab child on timeout attempt ${attempt}.`);
    const exit = await waitForExit(child, exitPromise);
    assert(!receivedResponse, `Pathological query completed before timeout attempt ${attempt}.`);
    assert(exit.signal === "SIGKILL", `Timeout child exited unexpectedly: ${JSON.stringify(exit)}`);
    console.log(`timeout ${attempt}: child killed and exit observed`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exitPromise;
    }
  }
}

const fixtureRoot = await mkdtemp(join(tmpdir(), "web-ide-sql-lab-child-termination-"));
try {
  const databasePath = join(fixtureRoot, "termination.sqlite");

  await runTimeout(databasePath, 1);
  await runQuickQuery(databasePath);
  for (let attempt = 2; attempt <= 6; attempt += 1) {
    await runTimeout(databasePath, attempt);
  }
  await runQuickQuery(databasePath);

  console.log("SQLL-09 child-process hard termination gate PASS");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

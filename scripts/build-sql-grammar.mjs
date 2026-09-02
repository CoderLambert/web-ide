import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(join(projectRoot, "scripts/sql-grammar.lock.json"), "utf8"));
const treeSitterBinary = join(projectRoot, "node_modules/.bin/tree-sitter");
const expectedWasmPath = "public/languages/sql/tree-sitter-sql.wasm";
const sha256Pattern = /^[a-f0-9]{64}$/;

if (
  typeof lock.repository !== "string" ||
  !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(lock.repository) ||
  typeof lock.revision !== "string" ||
  !/^[a-f0-9]{40}$/.test(lock.revision) ||
  typeof lock.treeSitterCli !== "string" ||
  !/^\d+\.\d+\.\d+$/.test(lock.treeSitterCli) ||
  typeof lock.emscripten !== "string" ||
  !/^\d+\.\d+\.\d+$/.test(lock.emscripten) ||
  lock.abi !== 15 ||
  !Number.isSafeInteger(lock.wasmBytes) ||
  lock.wasmBytes <= 0 ||
  typeof lock.wasmSha256 !== "string" ||
  !sha256Pattern.test(lock.wasmSha256) ||
  typeof lock.licenseSha256 !== "string" ||
  !sha256Pattern.test(lock.licenseSha256) ||
  lock.wasmPath !== expectedWasmPath
) {
  throw new Error("Invalid SQL grammar lock");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} exited with status ${result.status}`);
  }

  return result.stdout.trim();
}

const cliVersion = capture(treeSitterBinary, ["--version"]);
if (!cliVersion.includes(` ${lock.treeSitterCli} `)) {
  throw new Error(`Expected tree-sitter CLI ${lock.treeSitterCli}, received: ${cliVersion}`);
}

let emscriptenVersion;
try {
  emscriptenVersion = capture("emcc", ["--version"]);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    throw new Error(`emcc ${lock.emscripten} is required to build the SQL grammar`, {
      cause: error,
    });
  }
  throw error;
}

if (!emscriptenVersion.includes(` ${lock.emscripten} `)) {
  throw new Error(`Expected Emscripten ${lock.emscripten}, received: ${emscriptenVersion}`);
}

const buildRoot = await mkdtemp(join(tmpdir(), "web-ide-sql-grammar-"));
const sourceDirectory = join(buildRoot, "source");
const candidateWasm = join(buildRoot, "tree-sitter-sql.wasm");
const destinationWasm = join(projectRoot, lock.wasmPath);
const destinationDirectory = dirname(destinationWasm);
const destinationLicense = join(destinationDirectory, "LICENSE.tree-sitter-sql");
const stagedWasm = join(destinationDirectory, `.tree-sitter-sql.${randomUUID()}.wasm`);

try {
  run("git", ["init", "--quiet", sourceDirectory]);
  run("git", ["-C", sourceDirectory, "remote", "add", "origin", lock.repository]);
  run("git", [
    "-C",
    sourceDirectory,
    "fetch",
    "--quiet",
    "--depth",
    "1",
    "--no-tags",
    "origin",
    lock.revision,
  ]);
  run("git", ["-C", sourceDirectory, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);

  const revision = capture("git", ["-C", sourceDirectory, "rev-parse", "HEAD"]);
  if (revision !== lock.revision) {
    throw new Error(`Expected grammar revision ${lock.revision}, received ${revision}`);
  }

  run(treeSitterBinary, ["generate", "--abi", String(lock.abi)], {
    cwd: sourceDirectory,
  });
  run(treeSitterBinary, ["build", "--wasm", "--output", candidateWasm], {
    cwd: sourceDirectory,
  });

  const wasm = await readFile(candidateWasm);
  const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
  if (wasm.byteLength !== lock.wasmBytes) {
    throw new Error(`Expected SQL grammar size ${lock.wasmBytes}, received ${wasm.byteLength}`);
  }
  if (wasmSha256 !== lock.wasmSha256) {
    throw new Error(`Expected SQL grammar SHA256 ${lock.wasmSha256}, received ${wasmSha256}`);
  }

  const sourceLicense = join(sourceDirectory, "LICENSE");
  const licenseSha256 = createHash("sha256")
    .update(await readFile(sourceLicense))
    .digest("hex");
  if (licenseSha256 !== lock.licenseSha256) {
    throw new Error(
      `Expected SQL grammar license SHA256 ${lock.licenseSha256}, received ${licenseSha256}`,
    );
  }

  await mkdir(destinationDirectory, { recursive: true });
  const committedLicenseSha256 = createHash("sha256")
    .update(await readFile(destinationLicense))
    .digest("hex");
  if (committedLicenseSha256 !== lock.licenseSha256) {
    throw new Error(
      `Expected committed license SHA256 ${lock.licenseSha256}, received ${committedLicenseSha256}`,
    );
  }

  await copyFile(candidateWasm, stagedWasm);
  const stagedWasmSha256 = createHash("sha256")
    .update(await readFile(stagedWasm))
    .digest("hex");
  if (stagedWasmSha256 !== lock.wasmSha256) {
    throw new Error(`Staged SQL grammar SHA256 mismatch: ${stagedWasmSha256}`);
  }
  await rename(stagedWasm, destinationWasm);

  console.log(`Built ${lock.wasmPath}`);
  console.log(`Grammar revision: ${lock.revision}`);
  console.log(`WASM SHA256: ${wasmSha256}`);
} finally {
  await rm(stagedWasm, { force: true });
  await rm(buildRoot, { force: true, recursive: true });
}

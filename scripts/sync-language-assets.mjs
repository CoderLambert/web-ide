import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(projectRoot, "src/languages/sql/query-assets.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `${command} exited with status ${result.status}`);
  }
  return result.stdout.trim();
}

function validateManifest() {
  if (!Array.isArray(manifest) || manifest.length !== 2) {
    fail("SQL query asset manifest must contain exactly highlights and folds.");
  }

  const seenKinds = new Set();
  for (const [index, asset] of manifest.entries()) {
    if (asset === null || typeof asset !== "object") {
      fail(`Invalid SQL query asset at index ${index}.`);
    }
    if (asset.kind !== "highlights" && asset.kind !== "folds") {
      fail(`Unsupported SQL query asset kind at index ${index}.`);
    }
    if (seenKinds.has(asset.kind)) {
      fail(`Duplicate SQL query asset kind ${asset.kind}.`);
    }
    seenKinds.add(asset.kind);
    if (
      typeof asset.repository !== "string" ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(asset.repository)
    ) {
      fail(`Invalid repository for ${asset.kind}.`);
    }
    if (typeof asset.revision !== "string" || !/^[a-f0-9]{40}$/.test(asset.revision)) {
      fail(`Invalid pinned revision for ${asset.kind}.`);
    }
    if (typeof asset.path !== "string" || asset.path.startsWith("/") || asset.path.includes("..")) {
      fail(`Invalid source path for ${asset.kind}.`);
    }
    if (
      typeof asset.localArtifactPath !== "string" ||
      !asset.localArtifactPath.startsWith("/languages/sql/queries/") ||
      asset.localArtifactPath.endsWith("/")
    ) {
      fail(`Invalid local artifact path for ${asset.kind}.`);
    }
    if (typeof asset.license !== "string" || asset.license.length === 0) {
      fail(`Missing license for ${asset.kind}.`);
    }
    if (typeof asset.licensePath !== "string" || asset.licensePath.startsWith("/")) {
      fail(`Missing license path for ${asset.kind}.`);
    }
    if (!Array.isArray(asset.expectedCaptures) || asset.expectedCaptures.length === 0) {
      fail(`Missing expected captures for ${asset.kind}.`);
    }
    if (asset.patches !== undefined) {
      if (!Array.isArray(asset.patches)) {
        fail(`Invalid patches for ${asset.kind}.`);
      }
      for (const patch of asset.patches) {
        if (
          patch === null ||
          typeof patch !== "object" ||
          typeof patch.id !== "string" ||
          typeof patch.search !== "string" ||
          patch.search.length === 0 ||
          typeof patch.replace !== "string" ||
          !Number.isInteger(patch.expectedMatches) ||
          patch.expectedMatches < 1
        ) {
          fail(`Invalid declared patch for ${asset.kind}.`);
        }
      }
    }
  }

  if (!seenKinds.has("highlights") || !seenKinds.has("folds")) {
    fail("SQL query asset manifest must define highlights and folds.");
  }
}

function sourceFilePath(sourceRoot, assetPath) {
  const candidate = resolve(sourceRoot, assetPath);
  if (relative(sourceRoot, candidate).startsWith("..")) {
    fail(`Asset path escapes source checkout: ${assetPath}`);
  }
  return candidate;
}

function applyPatches(source, asset) {
  let result = source;
  for (const patch of asset.patches ?? []) {
    const matches = result.split(patch.search).length - 1;
    if (matches !== patch.expectedMatches) {
      fail(
        `Patch ${patch.id} for ${asset.kind} expected ${patch.expectedMatches} matches, received ${matches}.`,
      );
    }
    result = result.split(patch.search).join(patch.replace);
  }
  return result;
}

function artifactPath(root, localArtifactPath) {
  return join(root, "public", localArtifactPath.slice(1));
}

function provenanceLine(asset, artifactSha256) {
  return `- ${asset.kind}: ${asset.repository}@${asset.revision} (${asset.path}), license ${asset.license} (LICENSE.${asset.kind}.txt); artifact SHA-256 ${artifactSha256}`;
}

validateManifest();

const checkoutRoot = await mkdtemp(join(tmpdir(), "web-ide-language-assets-"));
const stagedRoot = await mkdtemp(join(tmpdir(), "web-ide-language-assets-stage-"));
const generatedNotices = [];

try {
  for (const asset of manifest) {
    const sourceRoot = join(checkoutRoot, asset.kind);
    run("git", ["init", "--quiet", sourceRoot]);
    run("git", ["-C", sourceRoot, "remote", "add", "origin", asset.repository]);
    run("git", [
      "-C",
      sourceRoot,
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "--no-tags",
      "origin",
      asset.revision,
    ]);
    run("git", ["-C", sourceRoot, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
    const revision = run("git", ["-C", sourceRoot, "rev-parse", "FETCH_HEAD"]);
    if (revision !== asset.revision) {
      fail(`Expected ${asset.kind} revision ${asset.revision}, received ${revision}.`);
    }

    const source = await readFile(sourceFilePath(sourceRoot, asset.path), "utf8");
    const artifact = applyPatches(source, asset);
    const stagedArtifactPath = artifactPath(stagedRoot, asset.localArtifactPath);
    await mkdir(dirname(stagedArtifactPath), { recursive: true });
    await writeFile(stagedArtifactPath, artifact, "utf8");

    const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
    const license = await readFile(sourceFilePath(sourceRoot, asset.licensePath), "utf8");
    const stagedLicensePath = join(
      stagedRoot,
      "public/languages/sql/queries",
      `LICENSE.${asset.kind}.txt`,
    );
    await writeFile(stagedLicensePath, license, "utf8");
    generatedNotices.push({ asset, artifactSha256 });
  }

  const notice = [
    "# SQL Query Assets — Third-Party Notices",
    "",
    "These query files are vendored for offline Web Worker execution.",
    "",
    ...generatedNotices.flatMap(({ asset, artifactSha256 }) => [
      provenanceLine(asset, artifactSha256),
      "",
    ]),
  ].join("\n");
  const stagedNoticePath = join(stagedRoot, "public/languages/sql/queries/THIRD_PARTY_NOTICES.md");
  await mkdir(dirname(stagedNoticePath), { recursive: true });
  await writeFile(stagedNoticePath, notice, "utf8");

  for (const asset of manifest) {
    const destination = artifactPath(projectRoot, asset.localArtifactPath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(artifactPath(stagedRoot, asset.localArtifactPath), destination);
    console.log(`Synced ${asset.localArtifactPath}`);
    await copyFile(
      join(stagedRoot, "public/languages/sql/queries", `LICENSE.${asset.kind}.txt`),
      join(projectRoot, "public/languages/sql/queries", `LICENSE.${asset.kind}.txt`),
    );
    console.log(`Synced /languages/sql/queries/LICENSE.${asset.kind}.txt`);
  }
  await copyFile(
    stagedNoticePath,
    join(projectRoot, "public/languages/sql/queries/THIRD_PARTY_NOTICES.md"),
  );
  console.log("Synced /languages/sql/queries/THIRD_PARTY_NOTICES.md");
} finally {
  await rm(checkoutRoot, { force: true, recursive: true });
  await rm(stagedRoot, { force: true, recursive: true });
}

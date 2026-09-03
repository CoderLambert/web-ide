import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, Query } from "web-tree-sitter";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(join(projectRoot, "src/languages/sql/query-assets.json"), "utf8"),
);
const grammarPath = join(projectRoot, "public/languages/sql/tree-sitter-sql.wasm");

function fail(message) {
  throw new Error(message);
}

function assetFor(kind) {
  const asset = manifest.find((candidate) => candidate.kind === kind);
  if (asset === undefined) {
    fail(`Missing SQL ${kind} asset manifest entry.`);
  }
  return asset;
}

function localAssetPath(asset) {
  return join(projectRoot, "public", asset.localArtifactPath.slice(1));
}

function capturesFor(query, tree) {
  return query.captures(tree.rootNode);
}

function hasCapture(captures, name, text) {
  return captures.some((capture) => capture.name === name.slice(1) && capture.node.text === text);
}

function requireCapture(captures, name, text, fixture) {
  if (!hasCapture(captures, name, text)) {
    fail(`Fixture ${fixture} did not produce ${name} for ${JSON.stringify(text)}.`);
  }
}

function requireCaptureName(query, name) {
  if (!query.captureNames.includes(name.slice(1))) {
    fail(`Query is missing expected capture ${name}.`);
  }
}

function reversePatches(source, asset) {
  let result = source;
  for (const patch of [...(asset.patches ?? [])].reverse()) {
    const matches = result.split(patch.replace).length - 1;
    if (matches !== patch.expectedMatches) {
      fail(
        `Cannot reconstruct unpatched ${asset.kind} query: patch ${patch.id} expected ${patch.expectedMatches} replacements, received ${matches}.`,
      );
    }
    result = result.split(patch.replace).join(patch.search);
  }
  return result;
}

function assertInvalidNodeType(language) {
  try {
    const invalidQuery = new Query(language, "(this_node_type_does_not_exist) @invalid");
    invalidQuery.delete();
  } catch {
    return;
  }
  fail("An invalid Tree-sitter node type unexpectedly compiled.");
}

const highlightsAsset = assetFor("highlights");
const foldsAsset = assetFor("folds");
let language;
let parser;
let highlightQuery;
let foldsQuery;
let tree;
let unpatchedQuery;

try {
  await Parser.init({
    locateFile: (fileName) =>
      fileName === "tree-sitter.wasm"
        ? resolve(projectRoot, "node_modules/web-tree-sitter/tree-sitter.wasm")
        : fileName,
  });
  language = await Language.load(new Uint8Array(await readFile(grammarPath)));
  parser = new Parser();
  parser.setLanguage(language);

  const highlightsSource = await readFile(localAssetPath(highlightsAsset), "utf8");
  const foldsSource = await readFile(localAssetPath(foldsAsset), "utf8");
  highlightQuery = new Query(language, highlightsSource);
  foldsQuery = new Query(language, foldsSource);

  for (const captureName of highlightsAsset.expectedCaptures) {
    requireCaptureName(highlightQuery, captureName);
  }
  for (const captureName of foldsAsset.expectedCaptures) {
    requireCaptureName(foldsQuery, captureName);
  }

  const highlightFixture = "SELECT lower('text'), 123, 1.25 FROM users; -- comment";
  tree = parser.parse(highlightFixture);
  if (tree === null) {
    fail("Highlight fixture did not produce a syntax tree.");
  }
  const highlightCaptures = capturesFor(highlightQuery, tree);
  requireCapture(highlightCaptures, "@keyword", "SELECT", "keyword");
  requireCapture(highlightCaptures, "@keyword", "FROM", "keyword");
  requireCapture(highlightCaptures, "@string", "'text'", "string");
  requireCapture(highlightCaptures, "@number", "123", "integer");
  requireCapture(highlightCaptures, "@float", "1.25", "float");
  requireCapture(highlightCaptures, "@comment", "-- comment", "comment");
  requireCapture(highlightCaptures, "@function.call", "lower", "function invocation");

  tree.delete();
  tree = parser.parse(
    "SELECT\n  id,\n  name\nFROM users\nWHERE id IN (\n  SELECT id FROM archive\n);\n",
  );
  if (tree === null) {
    fail("Folding fixture did not produce a syntax tree.");
  }
  const foldingCaptures = capturesFor(foldsQuery, tree).filter(
    (capture) => capture.name === "fold",
  );
  if (!foldingCaptures.some(({ node }) => node.startPosition.row < node.endPosition.row)) {
    fail("Multiline folding fixture did not produce a multiline @fold capture.");
  }

  const unpatchedSource = reversePatches(highlightsSource, highlightsAsset);
  unpatchedQuery = new Query(language, unpatchedSource);
  const unpatchedNumericFixture = parser.parse("SELECT 123, 1.25;");
  if (unpatchedNumericFixture === null) {
    fail("Unpatched numeric fixture did not produce a syntax tree.");
  }
  const unpatchedNumericCaptures = capturesFor(unpatchedQuery, unpatchedNumericFixture);
  if (
    hasCapture(unpatchedNumericCaptures, "@number", "123") ||
    hasCapture(unpatchedNumericCaptures, "@float", "1.25")
  ) {
    fail("Unpatched numeric predicate unexpectedly passed the compatibility regression.");
  }
  unpatchedNumericFixture.delete();

  assertInvalidNodeType(language);
  console.log("Query assets: compile PASS");
  console.log("Query assets: keyword/string/integer/float/comment/function behavior PASS");
  console.log("Query assets: multiline folding behavior PASS");
  console.log("Query assets: numeric predicate compatibility regression PASS");
  console.log("Query assets: invalid node type rejection PASS");
  console.log("Query assets: offline verification PASS");
} finally {
  unpatchedQuery?.delete();
  highlightQuery?.delete();
  foldsQuery?.delete();
  tree?.delete();
  parser?.delete();
}

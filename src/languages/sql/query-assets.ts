import type { QueryAssetManifestEntry } from "../../language/query-assets";

export const SQL_GRAMMAR_REPOSITORY = "https://github.com/DerekStride/tree-sitter-sql.git";
export const SQL_GRAMMAR_REVISION = "7b51ecda191d36b92f5a90a8d1bc3faef1c7b8b8";
export const SQL_FOLDS_REPOSITORY = "https://github.com/nvim-treesitter/nvim-treesitter.git";
export const SQL_FOLDS_REVISION = "cf12346a3414fa1b06af75c79faebe7f76df080a";

const SQL_HIGHLIGHTS_PATCH = {
  id: "sql-number-predicate-javascript-regexp",
  description:
    "Replace the Tree-sitter CLI %d shorthand with a JavaScript-compatible digit class for web-tree-sitter match? execution.",
  search: "%d",
  replace: "\\d",
  expectedMatches: 2,
} as const;

export const SQL_QUERY_ASSET_MANIFEST = [
  {
    kind: "highlights",
    repository: SQL_GRAMMAR_REPOSITORY,
    revision: SQL_GRAMMAR_REVISION,
    path: "queries/highlights.scm",
    license: "MIT",
    localArtifactPath: "/languages/sql/queries/highlights.scm",
    patches: [SQL_HIGHLIGHTS_PATCH],
    expectedCaptures: ["@keyword", "@string", "@number", "@float", "@comment", "@function.call"],
  },
  {
    kind: "folds",
    repository: SQL_FOLDS_REPOSITORY,
    revision: SQL_FOLDS_REVISION,
    path: "queries/sql/folds.scm",
    license: "Apache-2.0",
    localArtifactPath: "/languages/sql/queries/folds.scm",
    expectedCaptures: ["@fold"],
  },
] as const satisfies readonly QueryAssetManifestEntry[];

export type SqlQueryAssetKind = (typeof SQL_QUERY_ASSET_MANIFEST)[number]["kind"];

export function getSqlQueryAsset(kind: SqlQueryAssetKind): QueryAssetManifestEntry {
  const asset = SQL_QUERY_ASSET_MANIFEST.find((candidate) => candidate.kind === kind);
  if (asset === undefined) {
    throw new Error(`SQL query asset "${kind}" is not registered.`);
  }
  return asset;
}

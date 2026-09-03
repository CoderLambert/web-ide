import type { QueryAssetManifestEntry } from "../../language/query-assets";
import manifest from "./query-assets.json";

export const SQL_GRAMMAR_REPOSITORY = manifest[0].repository;
export const SQL_GRAMMAR_REVISION = manifest[0].revision;
export const SQL_FOLDS_REPOSITORY = manifest[1].repository;
export const SQL_FOLDS_REVISION = manifest[1].revision;

export const SQL_QUERY_ASSET_MANIFEST = manifest as readonly QueryAssetManifestEntry[];

export type SqlQueryAssetKind = (typeof SQL_QUERY_ASSET_MANIFEST)[number]["kind"];

export function getSqlQueryAsset(kind: SqlQueryAssetKind): QueryAssetManifestEntry {
  const asset = SQL_QUERY_ASSET_MANIFEST.find((candidate) => candidate.kind === kind);
  if (asset === undefined) {
    throw new Error(`SQL query asset "${kind}" is not registered.`);
  }
  return asset;
}

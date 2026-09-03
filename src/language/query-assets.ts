export const QUERY_ASSET_KINDS = ["highlights", "folds"] as const;

export type QueryAssetKind = (typeof QUERY_ASSET_KINDS)[number];

export interface QueryAssetPatch {
  readonly id: string;
  readonly description: string;
  readonly search: string;
  readonly replace: string;
  readonly expectedMatches: number;
}

export interface QueryAssetManifestEntry {
  readonly kind: QueryAssetKind;
  readonly repository: string;
  readonly revision: string;
  readonly path: string;
  readonly license: string;
  /** Browser-relative path used by the Worker runtime. */
  readonly localArtifactPath: string;
  readonly patches?: readonly QueryAssetPatch[];
  readonly expectedCaptures: readonly string[];
}

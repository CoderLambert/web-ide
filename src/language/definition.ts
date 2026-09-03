import type { QueryAssetManifestEntry } from "./query-assets";

export interface LanguageDefinition {
  id: string;
  extensions: string[];
  syntax: {
    grammarWasmPath: string;
    queryAssets?: readonly QueryAssetManifestEntry[];
  };
}

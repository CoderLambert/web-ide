import { Language, Query } from "web-tree-sitter";

import type { LanguageDefinition } from "../../../language/definition";
import type { QueryAssetKind, QueryAssetManifestEntry } from "../../../language/query-assets";

export interface QueryManagerDependencies {
  fetch: typeof globalThis.fetch;
  createQuery: (language: Language, source: string) => Query;
}

export type QueryManagerDependencyOverrides = Partial<QueryManagerDependencies>;

export interface QueryManagerOptions {
  definition: LanguageDefinition;
  loadLanguage: () => Promise<Language>;
  dependencies?: QueryManagerDependencyOverrides;
}

function defaultDependencies(): QueryManagerDependencies {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    createQuery: (language, source) => new Query(language, source),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class QueryManager {
  private readonly definition: LanguageDefinition;
  private readonly loadLanguage: () => Promise<Language>;
  private readonly dependencies: QueryManagerDependencies;
  private readonly queries = new Map<QueryAssetKind, Query>();
  private readonly queryPromises = new Map<QueryAssetKind, Promise<Query>>();
  private disposed = false;

  constructor(options: QueryManagerOptions) {
    this.definition = options.definition;
    this.loadLanguage = options.loadLanguage;
    this.dependencies = { ...defaultDependencies(), ...options.dependencies };
  }

  get cachedQueryCount(): number {
    return this.queries.size;
  }

  get pendingQueryCount(): number {
    return this.queryPromises.size;
  }

  getQuery(kind: QueryAssetKind): Promise<Query> {
    this.assertUsable();

    const cached = this.queries.get(kind);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const pending = this.queryPromises.get(kind);
    if (pending !== undefined) {
      return pending;
    }

    const queryPromise = this.loadAndCompile(kind)
      .then((query) => {
        if (this.disposed) {
          query.delete();
          throw new Error(`Query manager for "${this.definition.id}" was disposed.`);
        }

        if (this.queryPromises.get(kind) === queryPromise) {
          this.queryPromises.delete(kind);
        }
        this.queries.set(kind, query);
        return query;
      })
      .catch((error: unknown) => {
        if (this.queryPromises.get(kind) === queryPromise) {
          this.queryPromises.delete(kind);
        }
        throw error;
      });

    this.queryPromises.set(kind, queryPromise);
    return queryPromise;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.queryPromises.clear();
    for (const query of this.queries.values()) {
      query.delete();
    }
    this.queries.clear();
  }

  private async loadAndCompile(kind: QueryAssetKind): Promise<Query> {
    const asset = this.findAsset(kind);
    const response = await this.dependencies.fetch(asset.localArtifactPath);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${kind} query for "${this.definition.id}": HTTP ${response.status}.`,
      );
    }

    const source = await response.text();
    const language = await this.loadLanguage();
    try {
      return this.dependencies.createQuery(language, source);
    } catch (error: unknown) {
      throw new Error(
        `Failed to compile ${kind} query for "${this.definition.id}": ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  private findAsset(kind: QueryAssetKind): QueryAssetManifestEntry {
    const asset = this.definition.syntax.queryAssets?.find((candidate) => candidate.kind === kind);
    if (asset === undefined) {
      throw new Error(`No ${kind} query asset is registered for "${this.definition.id}".`);
    }
    return asset;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error(`Query manager for "${this.definition.id}" was disposed.`);
    }
  }
}

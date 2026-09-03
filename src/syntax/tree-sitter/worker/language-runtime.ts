import { Language, Parser, Query } from "web-tree-sitter";

import type { LanguageDefinition } from "../../../language/definition";
import type { QueryAssetKind } from "../../../language/query-assets";
import { QueryManager, type QueryManagerDependencies } from "./query-manager";

export interface LanguageRuntimeDependencies {
  fetch: typeof globalThis.fetch;
  loadLanguage: (bytes: Uint8Array) => Promise<Language>;
  createParser: () => Parser;
  createQuery: QueryManagerDependencies["createQuery"];
}

export type LanguageRuntimeDependencyOverrides = Partial<LanguageRuntimeDependencies>;

function defaultDependencies(): LanguageRuntimeDependencies {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    loadLanguage: (bytes) => Language.load(bytes),
    createParser: () => new Parser(),
    createQuery: (language, source) => new Query(language, source),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LanguageRuntime {
  readonly definition: LanguageDefinition;

  private readonly dependencies: LanguageRuntimeDependencies;
  private language: Language | undefined;
  private parser: Parser | undefined;
  private languagePromise: Promise<Language> | undefined;
  private parserPromise: Promise<Parser> | undefined;
  private readonly queryManager: QueryManager;
  private disposed = false;

  constructor(
    definition: LanguageDefinition,
    dependencies: LanguageRuntimeDependencyOverrides = {},
  ) {
    this.definition = definition;
    this.dependencies = { ...defaultDependencies(), ...dependencies };
    this.queryManager = new QueryManager({
      definition,
      loadLanguage: () => this.load(),
      dependencies: {
        fetch: this.dependencies.fetch,
        createQuery: this.dependencies.createQuery,
      },
    });
  }

  load(): Promise<Language> {
    this.assertUsable();

    if (this.language !== undefined) {
      return Promise.resolve(this.language);
    }

    if (this.languagePromise !== undefined) {
      return this.languagePromise;
    }

    const languagePromise = this.fetchAndLoadLanguage()
      .then((language) => {
        if (this.disposed) {
          throw new Error(`Language runtime "${this.definition.id}" was disposed.`);
        }

        this.language = language;
        return language;
      })
      .catch((error: unknown) => {
        if (this.languagePromise === languagePromise) {
          this.languagePromise = undefined;
        }
        throw error;
      });

    this.languagePromise = languagePromise;
    return languagePromise;
  }

  getParser(): Promise<Parser> {
    this.assertUsable();

    if (this.parser !== undefined) {
      return Promise.resolve(this.parser);
    }

    if (this.parserPromise !== undefined) {
      return this.parserPromise;
    }

    const parserPromise = this.load()
      .then((language) => {
        if (this.disposed) {
          throw new Error(`Language runtime "${this.definition.id}" was disposed.`);
        }

        const parser = this.dependencies.createParser();
        try {
          parser.setLanguage(language);
        } catch (error: unknown) {
          parser.delete();
          throw error;
        }

        this.parser = parser;
        return parser;
      })
      .catch((error: unknown) => {
        if (this.parserPromise === parserPromise) {
          this.parserPromise = undefined;
        }
        throw error;
      });

    this.parserPromise = parserPromise;
    return parserPromise;
  }

  getQuery(kind: QueryAssetKind): Promise<Query> {
    this.assertUsable();
    return this.queryManager.getQuery(kind);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.parserPromise = undefined;
    this.languagePromise = undefined;

    this.queryManager.dispose();
    this.parser?.delete();
    this.parser = undefined;
    this.language = undefined;
  }

  private async fetchAndLoadLanguage(): Promise<Language> {
    const response = await this.dependencies.fetch(this.definition.syntax.grammarWasmPath);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch grammar for "${this.definition.id}": HTTP ${response.status}.`,
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    try {
      return await this.dependencies.loadLanguage(bytes);
    } catch (error: unknown) {
      throw new Error(
        `Failed to load grammar for "${this.definition.id}": ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error(`Language runtime "${this.definition.id}" was disposed.`);
    }
  }
}

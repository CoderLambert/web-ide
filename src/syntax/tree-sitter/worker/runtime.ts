import { Parser } from "web-tree-sitter";
import treeSitterWasmUrl from "web-tree-sitter/tree-sitter.wasm?url";

import type { LanguageDefinition } from "../../../language/definition";
import { LanguageRegistry } from "../../../language/registry";
import { LanguageRuntime, type LanguageRuntimeDependencyOverrides } from "./language-runtime";

export interface WorkerRuntimeOptions {
  registry?: LanguageRegistry;
  parserInit?: () => Promise<void>;
  languageDependencies?: LanguageRuntimeDependencyOverrides;
  treeSitterWasmUrl?: string;
}

function defaultParserInit(wasmUrl: string): () => Promise<void> {
  return () =>
    Parser.init({
      locateFile: (fileName: string) => (fileName === "tree-sitter.wasm" ? wasmUrl : fileName),
    });
}

export class WorkerRuntime {
  private readonly registry: LanguageRegistry;
  private readonly parserInit: () => Promise<void>;
  private readonly languageDependencies: LanguageRuntimeDependencyOverrides;
  private readonly languageRuntimes = new Map<string, LanguageRuntime>();
  private parserInitPromise: Promise<void> | undefined;
  private disposed = false;

  constructor(options: WorkerRuntimeOptions = {}) {
    this.registry = options.registry ?? new LanguageRegistry();
    this.parserInit =
      options.parserInit ?? defaultParserInit(options.treeSitterWasmUrl ?? treeSitterWasmUrl);
    this.languageDependencies = options.languageDependencies ?? {};
  }

  initialize(): Promise<void> {
    this.assertUsable();

    if (this.parserInitPromise !== undefined) {
      return this.parserInitPromise;
    }

    const parserInitPromise = this.parserInit().catch((error: unknown) => {
      if (this.parserInitPromise === parserInitPromise) {
        this.parserInitPromise = undefined;
      }
      throw error;
    });

    this.parserInitPromise = parserInitPromise;
    return parserInitPromise;
  }

  registerLanguage(definition: LanguageDefinition): void {
    this.assertUsable();
    this.registry.register(definition);
  }

  getLanguageDefinition(languageId: string): LanguageDefinition | undefined {
    return this.registry.get(languageId);
  }

  getLanguageRuntime(languageId: string): LanguageRuntime | undefined {
    return this.languageRuntimes.get(languageId);
  }

  async loadLanguage(language: string | LanguageDefinition): Promise<LanguageRuntime> {
    this.assertUsable();

    const definition = this.resolveDefinition(language);
    await this.initialize();

    let languageRuntime = this.languageRuntimes.get(definition.id);
    if (languageRuntime === undefined) {
      languageRuntime = new LanguageRuntime(definition, this.languageDependencies);
      this.languageRuntimes.set(definition.id, languageRuntime);
    }

    try {
      await languageRuntime.getParser();
      return languageRuntime;
    } catch (error: unknown) {
      if (this.languageRuntimes.get(definition.id) === languageRuntime) {
        this.languageRuntimes.delete(definition.id);
      }
      languageRuntime.dispose();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const languageRuntime of this.languageRuntimes.values()) {
      languageRuntime.dispose();
    }
    this.languageRuntimes.clear();
    this.parserInitPromise = undefined;
  }

  private resolveDefinition(language: string | LanguageDefinition): LanguageDefinition {
    if (typeof language === "string") {
      const definition = this.registry.get(language);
      if (definition === undefined) {
        throw new Error(`Unknown language "${language}".`);
      }
      return definition;
    }

    const registeredDefinition = this.registry.get(language.id);
    if (registeredDefinition !== undefined) {
      return registeredDefinition;
    }

    this.registry.register(language);
    return language;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("Worker runtime was disposed.");
    }
  }
}

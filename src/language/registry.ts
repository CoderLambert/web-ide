import type { LanguageDefinition } from "./definition";

export class LanguageRegistry {
  private readonly definitions = new Map<string, LanguageDefinition>();

  register(definition: LanguageDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Language "${definition.id}" is already registered.`);
    }

    this.definitions.set(definition.id, definition);
  }

  get(id: string): LanguageDefinition | undefined {
    return this.definitions.get(id);
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }
}

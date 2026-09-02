export interface LanguageDefinition {
  id: string;
  extensions: string[];
  syntax: {
    grammarWasmPath: string;
  };
}

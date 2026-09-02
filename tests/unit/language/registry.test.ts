import { describe, expect, it } from "vite-plus/test";

import { LanguageRegistry } from "../../../src/language/registry";
import { sqlLanguageDefinition } from "../../../src/languages/sql/definition";

describe("LanguageRegistry", () => {
  it("registers and returns the SQL language definition", () => {
    const registry = new LanguageRegistry();

    registry.register(sqlLanguageDefinition);

    expect(registry.get("sql")).toEqual({
      id: "sql",
      extensions: [".sql"],
      syntax: {
        grammarWasmPath: "/languages/sql/tree-sitter-sql.wasm",
      },
    });
    expect(registry.has("sql")).toBe(true);
  });

  it("rejects duplicate language ids with an explicit error", () => {
    const registry = new LanguageRegistry();

    registry.register(sqlLanguageDefinition);

    expect(() => registry.register(sqlLanguageDefinition)).toThrow(
      'Language "sql" is already registered.',
    );
  });

  it("returns an explicit unknown-language result", () => {
    const registry = new LanguageRegistry();

    expect(registry.get("does-not-exist")).toBeUndefined();
    expect(registry.has("does-not-exist")).toBe(false);
  });

  it("accepts language definitions without language-specific registry logic", () => {
    const registry = new LanguageRegistry();
    const markdownDefinition = {
      id: "markdown",
      extensions: [".md"],
      syntax: { grammarWasmPath: "/languages/markdown/tree-sitter.wasm" },
    };

    registry.register(markdownDefinition);

    expect(registry.get("markdown")).toEqual(markdownDefinition);
  });
});

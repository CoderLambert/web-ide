import type { LanguageDefinition } from "../../language/definition";
import { SQL_QUERY_ASSET_MANIFEST } from "./query-assets";

export const SQL_LANGUAGE_ID = "sql";
export const SQL_GRAMMAR_WASM_PATH = "/languages/sql/tree-sitter-sql.wasm";

export const sqlLanguageDefinition: LanguageDefinition = {
  id: SQL_LANGUAGE_ID,
  extensions: [".sql"],
  syntax: {
    grammarWasmPath: SQL_GRAMMAR_WASM_PATH,
    queryAssets: SQL_QUERY_ASSET_MANIFEST,
  },
};

export const SQL_LANGUAGE_DEFINITION = sqlLanguageDefinition;
export default sqlLanguageDefinition;

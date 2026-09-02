import { Language, Parser } from "web-tree-sitter";
import treeSitterWasmUrl from "web-tree-sitter/tree-sitter.wasm?url";

const sqlGrammarUrl = import.meta.env.DEV
  ? new URL(
      `${import.meta.env.BASE_URL}languages/sql/tree-sitter-sql.wasm`,
      globalThis.location.origin,
    ).href
  : new URL(/* @vite-ignore */ "../languages/sql/tree-sitter-sql.wasm", import.meta.url).href;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadSqlGrammar() {
  const response = await fetch(sqlGrammarUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch the SQL grammar: ${response.status}`);
  }

  // Passing bytes avoids web-tree-sitter 0.25.10 mistaking Vite's process shim for Node.
  return Language.load(new Uint8Array(await response.arrayBuffer()));
}

void Parser.init({
  locateFile: (fileName: string) =>
    fileName === "tree-sitter.wasm" ? treeSitterWasmUrl : fileName,
})
  .then(() => loadSqlGrammar())
  .then(() => {
    globalThis.postMessage({ type: "ready" });
  })
  .catch((error: unknown) => {
    console.error("Failed to initialize the S0 Tree-sitter Worker", error);
    globalThis.postMessage({ message: errorMessage(error), type: "error" });
  });

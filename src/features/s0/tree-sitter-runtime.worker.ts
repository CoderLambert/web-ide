import { Language, Parser } from "web-tree-sitter";
import treeSitterWasmUrl from "web-tree-sitter/tree-sitter.wasm?url";

interface ParseRequest {
  source: string;
  type: "parse";
}

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

function isParseRequest(value: unknown): value is ParseRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "parse" &&
    "source" in value &&
    typeof value.source === "string"
  );
}

void Parser.init({
  locateFile: (fileName: string) =>
    fileName === "tree-sitter.wasm" ? treeSitterWasmUrl : fileName,
})
  .then(() => loadSqlGrammar())
  .then((language) => {
    const parser = new Parser();
    parser.setLanguage(language);

    globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!isParseRequest(event.data)) {
        return;
      }

      try {
        const tree = parser.parse(event.data.source);

        if (tree === null) {
          throw new Error("SQL parser returned no tree");
        }

        try {
          const rootNode = tree.rootNode;
          globalThis.postMessage({
            hasError: rootNode.hasError,
            rootType: rootNode.type,
            treeString: rootNode.toString(),
            type: "parse-result",
          });
        } finally {
          tree.delete();
        }
      } catch (error: unknown) {
        console.error("Failed to parse SQL in the S0 Tree-sitter Worker", error);
        globalThis.postMessage({ message: errorMessage(error), type: "error" });
      }
    });

    globalThis.postMessage({ type: "ready" });
  })
  .catch((error: unknown) => {
    console.error("Failed to initialize the S0 Tree-sitter Worker", error);
    globalThis.postMessage({ message: errorMessage(error), type: "error" });
  });

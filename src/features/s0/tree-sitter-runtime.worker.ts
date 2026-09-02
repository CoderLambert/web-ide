import { Parser } from "web-tree-sitter";
import treeSitterWasmUrl from "web-tree-sitter/tree-sitter.wasm?url";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

void Parser.init({
  locateFile: (fileName: string) =>
    fileName === "tree-sitter.wasm" ? treeSitterWasmUrl : fileName,
})
  .then(() => {
    globalThis.postMessage({ type: "ready" });
  })
  .catch((error: unknown) => {
    globalThis.postMessage({ message: errorMessage(error), type: "error" });
  });

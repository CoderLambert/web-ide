import { createFileRoute } from "@tanstack/react-router";

import { LspJsonRpcProbe } from "#/features/s0/lsp-jsonrpc-probe";
import { MonacoLifecycleProbe } from "#/features/s0/monaco-lifecycle-probe";
import { TreeSitterRuntimeProbe } from "#/features/s0/tree-sitter-runtime-probe";

export const Route = createFileRoute("/ide")({
  ssr: false,
  component: IdeCompatibilityPage,
});

function IdeCompatibilityPage() {
  return (
    <>
      <MonacoLifecycleProbe />
      <TreeSitterRuntimeProbe />
      <LspJsonRpcProbe />
    </>
  );
}

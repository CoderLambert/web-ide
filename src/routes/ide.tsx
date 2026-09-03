import { createFileRoute } from "@tanstack/react-router";

import { MonacoSyntaxBindingProbe } from "#/features/m1/monaco-syntax-binding-probe";
import { SyntaxCapabilityProbe } from "#/features/m2/syntax-capability-probe";
import { WorkspaceFoundationProbe } from "#/features/m25/workspace-foundation-probe";
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
      <MonacoSyntaxBindingProbe />
      <SyntaxCapabilityProbe />
      <WorkspaceFoundationProbe />
      <MonacoLifecycleProbe />
      <TreeSitterRuntimeProbe />
      <LspJsonRpcProbe />
    </>
  );
}

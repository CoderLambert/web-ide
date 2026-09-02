import { createFileRoute } from "@tanstack/react-router";

import { MonacoLifecycleProbe } from "#/features/s0/monaco-lifecycle-probe";

export const Route = createFileRoute("/ide")({
  ssr: false,
  component: IdeCompatibilityPage,
});

function IdeCompatibilityPage() {
  return <MonacoLifecycleProbe />;
}

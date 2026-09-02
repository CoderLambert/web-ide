import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="landing-page">
      <p className="eyebrow">CoderLambert / web-ide</p>
      <h1>Runtime compatibility workspace</h1>
      <p>
        This repository currently freezes and validates the Monaco, Tree-sitter, SQL grammar WASM,
        and minimal LSP runtime stack.
      </p>
      <a className="primary-link" href="/ide">
        Open the S0 compatibility probes
      </a>
    </main>
  );
}

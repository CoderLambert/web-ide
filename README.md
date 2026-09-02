# Web IDE

Production-oriented browser IDE foundation built with TanStack Start, Monaco and Tree-sitter.

## Current status

```text
S0 Runtime Compatibility   PASS / sealed
M1 Syntax Foundation       PASS / sealed
Next                       M2 Syntax UX
```

M2 has not started yet. Workspace Foundation (M2.5) and the real Language Server integration (M3) are also not implemented yet.

The repository currently contains:

- TanStack Start with a client-only `/ide` route.
- Monaco editor/model/provider lifecycle and editor Worker loading.
- Exact, pinned runtime compatibility versions recorded in `runtime-lock.json`.
- A pinned, self-built SQL Tree-sitter grammar WASM.
- `LanguageDefinition` / `LanguageRegistry` foundations.
- A validated Tree-sitter Worker protocol with multi-document sessions and global FIFO dispatch.
- UTF-16 Monaco edits converted to Tree-sitter UTF-8 edits with incremental parsing and Full Resync fallback.
- Monaco model binding, bounded Worker crash recovery and latest-snapshot restore.
- An on-demand bounded AST Inspector.
- Reproducible M1 production verification and deterministic syntax performance diagnostics.
- A minimal Monaco Language Client WebSocket / JSON-RPC connection to a disposable mock server retained as the S0 compatibility baseline.

The real Workspace filesystem, Query-based Syntax UX and real SQL Language Server remain later milestones.

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000/ide> to inspect the current runtime and M1 probes.

## Verification

The current full sealed gate is:

```bash
pnpm verify:m1
```

It covers the frozen install, unit tests, typecheck, lint/check, production build/preview and the S0/M1 Playwright regression suite.

Useful focused commands:

```bash
pnpm verify:s0
pnpm test:m1
pnpm bench:m1
pnpm verify:sql-grammar
pnpm typecheck
pnpm check
pnpm build
```

`pnpm bench:m1` is diagnostic only; machine-dependent latency is not a CI hard-fail threshold. The current benchmark history and methodology are recorded in `docs/benchmarks/M1_SYNTAX_PERFORMANCE.md`.

The SQL grammar artifact is produced from the pinned revision in `scripts/sql-grammar.lock.json`; rebuilding it requires the locked Tree-sitter CLI and Emscripten versions.

## Architecture / task plan

The long-term architecture is documented in:

```text
docs/TanStack_Start_Monaco_Tree-sitter_LSP_Web_IDE_实施方案_V2.md
```

Executable milestone tasks live in:

```text
docs/codex-web-ide-v2-tasks/
```

For the current next milestone, start with:

```text
docs/codex-web-ide-v2-tasks/03_M2_SYNTAX_UX.md
```

Current-stage task documents and Review Gates are authoritative for executable task dependencies/DTO details; the large V2 document remains the architectural overview.

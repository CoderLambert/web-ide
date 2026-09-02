# Web IDE

This repository is the S0 runtime baseline for a browser-based IDE built with TanStack Start. It currently validates the production compatibility of:

- TanStack Start with a client-only `/ide` route
- Monaco editor/model/provider lifecycle and editor Worker loading
- `web-tree-sitter` Worker initialization and restart
- a pinned, self-built SQL grammar WASM and SQL parsing
- a minimal Monaco Language Client WebSocket / JSON-RPC connection to a disposable mock server

S0 is intentionally a compatibility spike. It does not yet contain the Workspace, language registry, incremental syntax engine, SQL Language Server, or other M1+ architecture.

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000/ide> to inspect the probes.

## Verification

Run the complete production gate with one command:

```bash
pnpm verify:s0
```

The gate runs the frozen install, TypeScript typecheck, formatting/lint checks, production build, production preview, and five Playwright tests. The tests cover Monaco remount/dispose, Tree-sitter Worker init/terminate/restart, SQL grammar load, SQL parse, LSP initialize/request/disconnect/reconnect/dispose, and assert zero browser console errors and zero uncaught page errors.

Individual commands:

```bash
pnpm typecheck
pnpm check
pnpm test
pnpm build
pnpm preview
```

The LSP test starts its own disposable mock server. The SQL grammar artifact is produced from the pinned revision in `scripts/sql-grammar.lock.json`; rebuilding it requires the locked Tree-sitter CLI and Emscripten versions.

When changing the SQL grammar revision or build toolchain, verify a byte-identical rebuild with:

```bash
pnpm verify:sql-grammar
```

## Runtime freeze

The verified versions, SQL grammar revision/ABI/SHA-256, LSP dependencies, commands, and gate results are recorded in [runtime-lock.json](runtime-lock.json) and [ADR-001-runtime-stack.md](docs/adr/ADR-001-runtime-stack.md).

The project follows the implementation plan in [docs/TanStack_Start_Monaco_Tree-sitter_LSP_Web_IDE_实施方案_V2.md](docs/TanStack_Start_Monaco_Tree-sitter_LSP_Web_IDE_实施方案_V2.md). S0 must remain passing before work begins on M1.

# ADR-001: Freeze the S0 Runtime Stack

- Status: Accepted
- Date: 2026-09-02
- Scope: S0 production compatibility gate

## Decision

Freeze the smallest runtime combination that passed the S0 production build and preview checks:

| Area          | Verified choice                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Node / pnpm   | Node `24.20.0`, pnpm `11.25.0`                                                                                                           |
| React         | React and React DOM `19.2.0`                                                                                                             |
| TanStack      | React Start `1.168.49`, React Router `1.170.32`, Router CLI `1.167.33`                                                                   |
| Vite          | Vite+ `0.3.0`, Vite+ Core `0.3.0`, bundled Vite `8.2.2`                                                                                  |
| Monaco group  | monaco-editor `0.55.1`, monaco-languageclient `10.7.0`, `@codingame/monaco-vscode-api` `25.1.2`                                          |
| Tree-sitter   | web-tree-sitter `0.25.10`, tree-sitter-cli `0.25.10`                                                                                     |
| Emscripten    | `4.0.4` for the pinned SQL grammar build                                                                                                 |
| SQL grammar   | DerekStride/tree-sitter-sql tag `v0.3.11`, revision `7b51ecda191d36b92f5a90a8d1bc3faef1c7b8b8`, ABI `15`                                 |
| SQL WASM      | `public/languages/sql/tree-sitter-sql.wasm`, 2,468,133 bytes, SHA-256 `d16a31c479635dbe97ef89be8b49c6e55efd201e1d3520ac54fe92095a34c4d2` |
| LSP transport | `vscode-ws-jsonrpc` `3.5.0`, `ws` `8.21.3`, WebSocket / JSON-RPC 2.0                                                                     |

All core versions are exact in `package.json` and represented in `pnpm-lock.yaml`. The full machine-readable record is [runtime-lock.json](../../runtime-lock.json).

## Compatibility evidence

`/ide` is configured with `ssr: false`. The S0 probes verify:

- Monaco creates and disposes an editor, model, and provider, then survives route remount.
- A module Worker initializes web-tree-sitter, loads the pinned SQL grammar, parses `SELECT id, name FROM users WHERE active = true;`, and restarts after termination.
- The LSP client connects to the disposable mock server, initializes, completes a JSON-RPC request/response round trip, disconnects, reconnects, and disposes.
- The production preview passes all five Playwright tests with zero captured browser console errors and zero uncaught page errors.

The LSP probe also clears a rejected API initialization promise so a failed first start can be retried. Unmount disposal catches asynchronous cleanup failures, and socket closure is attempted even if the language client dispose call rejects.

## Verification commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm check
pnpm test
pnpm build
pnpm preview
pnpm verify:sql-grammar
pnpm verify:s0
```

`pnpm verify:s0` runs the frozen install, typecheck, check, production build, starts a production preview, and runs the full S0 browser suite against that preview. The existing production build warning from `web-tree-sitter` is third-party bundler output; it does not fail the build or runtime gate.

`pnpm verify:sql-grammar` was rerun with Emscripten `4.0.4` from an isolated temporary emsdk. `emcc --version` matched the lock, and the generated SQL grammar matched the committed size and SHA-256; the verification did not modify the system shell environment.

## Consequences

- The runtime stack is stable for the remainder of S0 and must not drift without rerunning the compatibility gate.
- M1 must build on these versions; Monaco, Tree-sitter, and LSP are not upgraded opportunistically.
- The repository keeps only the S0 shell and compatibility probes. Workspace, syntax framework, semantic LSP, and later milestones remain out of scope.

# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- **S0-01:** TanStack Start `/ide` client-only shell.
- **S0-02:** Exact Monaco compatibility group, editor/model/provider lifecycle management, a Monaco editor worker factory, and dev/production Playwright dispose/remount validation.
- **S0-03:** Exact `web-tree-sitter`/`tree-sitter-cli` `0.25.10` pinning, module Worker runtime initialization, Vite-managed WASM loading, and dev/production lifecycle E2E coverage.
- **S0-04:** Pinned DerekStride/tree-sitter-sql `v0.3.11` at commit `7b51ecda191d36b92f5a90a8d1bc3faef1c7b8b8`, built with CLI `0.25.10` and Emscripten `4.0.4` for ABI15; recorded self-built WASM SHA `d16a31c479635dbe97ef89be8b49c6e55efd201e1d3520ac54fe92095a34c4d2`, with Worker `Language.load` verified in development and production.
- **S0-05:** Minimal SQL parse inside the module Worker, returning the root node type, error state, and syntax tree debug string for the fixed compatibility query.
- **S0-06:** Minimal Monaco Language Client WebSocket/JSON-RPC connection against a disposable mock server, covering initialize, request/response, disconnect, reconnect, and disposal.

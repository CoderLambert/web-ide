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
- **S0-07:** Unified production compatibility gate with frozen install, typecheck, lint/check, production build/preview, and browser regression tests; hardened LSP initialization retry and asynchronous unmount disposal.
- **S0-08:** Removed unused scaffold integrations and dependencies, froze the verified runtime stack, and documented the baseline in `runtime-lock.json` and ADR-001.
- **M1 Language/Syntax foundation:** Added `LanguageDefinition` / `LanguageRegistry`, runtime-validated Worker protocol, language runtime, multi-document sessions, FIFO Worker host, Worker supervisor and typed client.
- **M1 incremental editing:** Added UTF-16 → UTF-8 edit encoding, atomic batch edits, incremental Tree-sitter parsing, changed ranges, poisoned-tree handling and Full Resync fallback.
- **M1 Monaco integration:** Added model/session binding, real model version handling, language-change session replacement and safe close/dispose lifecycle.
- **M1 recovery:** Added bounded Worker crash recovery with generation changes, latest Monaco snapshot restore, pending-request cleanup and real Worker recovery E2E coverage.
- **M1 inspector:** Added bounded, on-demand serializable AST inspection without exposing Tree-sitter nodes to the main thread.
- **M1 verification:** Added `verify:m1`, `bench:m1`, deterministic 10KB/100KB/1MB syntax diagnostics and production-preview regression coverage.

### Changed

- Optimized EditCodec from repeated UTF-16/UTF-8 rescans to sparse edit-boundary metrics, removing document-size auxiliary TypedArray allocation while preserving the public API and Worker Protocol.
- Converged Workspace architecture on `WorkspacePath → WorkspaceFileSystem → RemoteWorkspaceFileSystem / Workspace API → BackendWorkspaceFileSystem`, with Backend filesystem as the single persisted source of truth.
- Clarified Web-first LSP transport/filesystem boundaries without prebuilding Desktop/Neovim adapters or locking deployment to a specific mount/jail mechanism.
- Hardened M2 planning around real Query asset provenance, stable versioned Syntax capability DTOs, bounded derived requests, Query lifecycle/resource validation and offline build/runtime assets.

# Codex Task Master Index

当前状态：

```text
S0 PASS / sealed
M1 PASS / sealed
M2 PASS / sealed
M2.5 active
W-01 PASS / sealed
Next: W-02 WorkspaceFileSystem Contract
```

## Phase S0

```text
S0-01
  ↓
S0-02
  ↓
S0-03
  ↓
S0-04 ──┐
  ↓      ├─→ S0-07 → S0-08 → REVIEW
S0-05   │
         │
S0-06 ──┘
```

## Phase M1

详细执行入口：`m1/00_M1_EXECUTION_INDEX.md`

```text
M1-01 Registry ─┐
                ├→ M1-03 Runtime → M1-04 Sessions → M1-05 WorkerHost → M1-06 Supervisor
M1-02 Protocol ─┘                                                        │
       ├────────────────────────────────────────────────────────────────→ M1-07 Client
       └→ M1-08 EditCodec

M1-04 + M1-05 + M1-08
        ↓
M1-09 Incremental
        ↓
M1-10 Full Resync
        ↓
M1-11 Monaco Binding
        ├→ M1-12 Recovery ─┐
        └→ M1-13 Inspector ┤
                           ↓
                    M1-14 Final Gate
                           ↓
                         REVIEW
```

## Phase M2

```text
M2-01 Query Assets
        ↓
M2-02 Asset Sync
        ↓
M2-03 Asset Verify
     ┌──┴──────────────┐
     ↓                 ↓
M2-04 QueryManager  M2-05 Capability Protocol/DTO

M2-04 + M2-05 → M2-06 Highlight
M2-04 + M2-05 → M2-07 Folding
M2-05         → M2-08 Selection

M2-06 + M2-07 + M2-08
        ↓
M2-09 Final Gate → REVIEW
```

## Phase M2.5

```text
W-01 WorkspacePath / URI
        ↓
W-02 WorkspaceFileSystem Contract
        ↓
W-03 BackendWorkspaceFileSystem
        ↓
W-04 Remote FS / API
        ↓
W-05 Monaco / Dirty Overlay
        ↓
W-06 Operations Lifecycle
        ↓
W-07 Backend Visibility
        ↓
W-08 Integration Gate → REVIEW
```

## Phase M3

```text
LSP-01
 ├→ LSP-02 ─┐
 └→ LSP-03 ─┤
             └→ LSP-04 → LSP-05 → LSP-06 → LSP-07 → LSP-08 → LSP-09
```

## Phase M4

```text
M4-01 → M4-02 ─┐
                ├→ M4-06 REVIEW
M4-03 → M4-04 ─┤
M4-05 ─────────┘
```

## Phase M5

```text
M5-01 DAP Spike
  ├→ M5-02 JS Debug
  └→ M5-03 Python Debug

M5-04 Structural Navigation
M5-05 Structural Search Spike
M5-06 AI Context
        ↓
M5-07 Advanced Gate
```

# M1 Execution Index

每次只执行当前允许的 Task。任务 PASS 后再进入依赖它的下一项。

## 依赖图

```text
M1-01 Registry/Test Foundation ─┐
                               ├→ M1-03 Runtime → M1-04 Sessions → M1-05 WorkerHost → M1-06 Supervisor
M1-02 Protocol ─────────────────┘                                                        │
       │                                                                                ↓
       ├────────────────────────────────────────────────────────────────────────────→ M1-07 Client
       └→ M1-08 EditCodec

M1-04 + M1-05 + M1-08
        ↓
M1-09 Incremental Parse
        ↓
M1-10 Full Resync
        ↓
M1-11 Monaco Binding
        ├→ M1-12 Worker Recovery ─┐
        └→ M1-13 AST Inspector ───┤
                                  ↓
                         M1-14 Final Gate
                                  ↓
                               M1 REVIEW
```

## 文档

| 文档 | 任务 | 主题 |
|---|---|---|
| `01_LANGUAGE_PROTOCOL.md` | M1-01 ~ M1-02 | Registry、Unit Test、Protocol |
| `02_RUNTIME_SESSIONS.md` | M1-03 ~ M1-04 | Runtime、Language、DocumentSession |
| `03_WORKER_CLIENT.md` | M1-05 ~ M1-07 | FIFO WorkerHost、Supervisor Core、Client |
| `04_EDIT_INCREMENTAL.md` | M1-08 ~ M1-09 | UTF-16/UTF-8、事务、Incremental Parse |
| `05_RESYNC_MONACO.md` | M1-10 ~ M1-11 | Full Resync、真实 Monaco Binding |
| `06_RECOVERY_INSPECTOR.md` | M1-12 ~ M1-13 | Worker Recovery、AST Inspector |
| `07_M1_FINAL_GATE.md` | M1-14 | Integration、Performance、Resource Gate |

## 可并行

接口已冻结时允许：

```text
M1-01 || M1-02
M1-04 tests || M1-08 EditCodec
M1-06 Supervisor Core || M1-08 EditCodec
M1-12 Recovery || M1-13 Inspector（M1-11 PASS 后）
```

禁止并行：

```text
Protocol 未 PASS → Client/Runtime
DocumentSession 未 PASS → Incremental Parse
Incremental 未 PASS → Full Resync
Full Resync 未 PASS → Monaco Binding
Monaco Binding 未 PASS → Recovery
```

## 每个 Task 的完成规则

```text
Inspect
→ Implement only current scope
→ unit/integration tests
→ typecheck/check
→ Review
→ fix
→ Commit Agent
→ git push
```

任何 Task `FAIL/BLOCKED`：停止依赖链，不提前实现后续任务。
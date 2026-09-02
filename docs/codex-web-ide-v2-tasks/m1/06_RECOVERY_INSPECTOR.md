# M1-12 ~ M1-13 — Recovery / Inspector

## M1-12 Worker Recovery

依赖：`M1-06 PASS`, `M1-11 PASS`

### 目标

Worker crash 后从当前最新文档快照恢复 Syntax State，不丢恢复期间用户编辑。

### 允许修改

```text
src/syntax/tree-sitter/worker-supervisor.ts
src/syntax/tree-sitter/client.ts
必要 composition/binding recovery glue
相关 tests
```

### 边界

Supervisor 不 import Monaco，只接收项目 DTO/callback：

```text
getOpenDocumentSnapshots()
```

快照：

```text
documentUri
sessionId
languageId
documentVersion
text
```

### Recovery

```text
worker crash
-> reject old-generation pending requests
-> generation++
-> spawn
-> WorkerReady
-> read latest open snapshots
-> OpenDocument(latest snapshot)
-> ready
```

恢复期间用户继续编辑时，不得恢复旧 v10 后丢掉 v11/v12。优先重新读取最新 snapshot；版本不能连续衔接时直接 full resync，不做复杂补洞。

恢复期间 close：删除 recovery entry，不能在新 Worker 复活文档。

language change：旧 session 结束，新 session 恢复。

### Restart Policy

第一版只允许有限自动恢复，例如 1 次；持续失败进入 `failed`，禁止 crash loop。

### 验证

- crash -> generation++ -> documents restored。
- old response dropped。
- old pending count = 0。
- edit during recovery 不丢。
- close during recovery 不复活。
- language change during recovery 正确。
- repeated crash 最终 failed。

---

## M1-13 On-demand AST Inspector

依赖：`M1-09 PASS`, `M1-11 PASS`

### 目标

提供开发调试 AST 查看，但不进入 parse 热路径。

### 允许修改

```text
src/syntax/tree-sitter/worker/inspector.ts
必要 protocol/client wiring
最小 /ide inspector UI
相关 tests
```

### Request

```text
documentUri
sessionId
expectedVersion
maxDepth
maxNodes
```

返回 bounded serializable DTO；禁止返回 `SyntaxNode/Tree/TreeCursor`。

### 验证

- SQL 可 inspect。
- stale expectedVersion 被拒绝。
- maxDepth/maxNodes 生效。
- 普通输入时不 serialize AST。
- 大文档 Inspector 不无限返回。

### 禁止

不做复杂 Tree UI、Query Inspector、语法业务模型。

## Stop Rule

Recovery 与 Inspector 分别独立 review/commit/push；M1-13 不是 Recovery 的依赖，可在 M1-12 接口稳定后并行收尾。

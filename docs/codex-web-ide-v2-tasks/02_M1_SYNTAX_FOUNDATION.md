# 02 — M1 Syntax Foundation

状态：Approved for implementation  
进入条件：`S0 PASS`

## 目标

```text
Monaco Model
  ↓
MonacoSyntaxBinding
  ↓
TreeSitterClient
  ↓
WorkerSupervisor
  ↓
WorkerHost / FIFO
  ↓
LanguageRuntime + DocumentSession
  ↓
Incremental Tree-sitter
```

M1 只建立 Syntax Foundation，不做 Query/Highlight、Workspace、真实 LSP、DAP 或 SQL Semantic Model。

## 核心红线

- `src/syntax/**` 不得依赖 Monaco。
- 业务层不得拿 `SyntaxNode` / `Tree`。
- Worker 只是可丢弃 Derived State，不是代码 Source of Truth。
- `ApplyChanges` 必须使用 `baseVersion -> nextVersion`。
- Worker 消息第一版全局 FIFO。
- 增量失败必须可 `ReplaceDocument` Full Resync。
- `tree.edit()` 后失败的 Tree 不得继续使用。
- Worker restart 必须清理旧 pending requests，恢复期间不能丢用户编辑。
- 不提前引入 Rope、Parser Pool、Multiple Workers、Query 系统。

## 执行入口

从以下索引开始：

```text
docs/codex-web-ide-v2-tasks/m1/00_M1_EXECUTION_INDEX.md
```

Codex 必须按索引依赖执行。每个任务完成后：

```text
Implement → Validate → Review → Commit → Push → Stop/Next allowed task
```

阶段完成后执行 `08_REVIEW_GATES.md` 中的 M1 Review。

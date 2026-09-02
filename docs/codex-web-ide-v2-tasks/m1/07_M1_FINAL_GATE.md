# M1-14 — Integration / Performance / Resource Gate

依赖：`M1-01 ~ M1-13 PASS`

## 目标
不新增功能，只做整阶段验证、修复和最终 Review。

## 必须验证
```text
Language Registry
Protocol runtime validation
multi document
close/reopen
sessionId lifecycle
Worker FIFO
Unicode / emoji
LF / CRLF
batch/multi-cursor edits
undo/redo
incremental parse
full resync
real Monaco binding
worker crash recovery
edit during recovery
close during recovery
stale response rejection
AST Inspector bounds
20 open/close
S0 regression
production build/preview
```

## Performance Fixture
使用 deterministic generator 生成固定：
```text
100KB valid SQL
1MB valid SQL
```

不要提交巨大手写 fixture。

测量建议：
```text
warmup: 10 edits
measurement: 100 edits
worker parse P50/P95
main-thread request->result P50/P95
```

`incremental parse P95 < 50ms` 当前作为 reference target；CI hardware 未固定前，不因单机略超 50ms 自动重构架构。

硬 Gate：
```text
100KB 连续编辑正确
1MB open 正确
1MB incremental edit 正确
UI 不冻结
Worker 不 crash
```

## Resource Gate
20 次 open/close 后：
```text
DocumentSession count = 0
Tree count = 0
pending request count = 0
```
Parser/LanguageRuntime 可缓存到 Worker 生命周期结束。

## 验证命令
最终建议建立：
```bash
pnpm verify:m1
```
保持简单，不引入新 Task Runner。

至少组合：
```text
unit tests
S0 E2E
M1 integration/E2E
typecheck
check
build
production preview
```

## Final Review 红线
任何一项存在则 M1 FAIL：
```text
Syntax Core import Monaco
业务层拿 SyntaxNode/Tree
SQL-specific TreeSitterEngine
Worker 成为 Source of Truth
ApplyChanges 无 baseVersion
Worker async message 无 FIFO
incremental failure 无 Full Resync
edited failed Tree 被继续使用
restart 后 pending request 泄漏
recovery 丢用户编辑
普通 parse 发送完整 AST
为未证明性能问题引入 Rope/Worker Pool
```

## 上游风险记录
M1 不使用 Query，不因为未来 Query 风险升级 `web-tree-sitter`。进入 M2 Query Gate 时单独重新审查 Query 内存行为。

## 完成条件
```text
M1-01 ~ M1-14 PASS
M1 Review PASS
S0 regression PASS
all commits pushed
git status clean
```

完成后停止，不自动进入 M2。
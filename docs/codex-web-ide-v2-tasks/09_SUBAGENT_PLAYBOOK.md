# 09 — 子 Agent 分配指南

目标：加快实现，但不制造 merge 冲突和上下文污染。

---

# 1. 推荐角色

## Coordinator / Main Agent

负责：

```text
任务依赖检查
接口冻结
任务分配
结果集成
最终验证
Stop Rule
```

主 Agent 不要把自己变成“同时写所有模块”的实现 Agent。

---

## Implementation Agent

负责一个明确文件边界的模块。

输入必须包含：

```text
Task ID
目标
允许修改路径
现有接口
验证要求
禁止事项
```

完成后立即停止。

---

## Test Agent

负责：

```text
测试用例
边界条件
回归测试
测试执行
```

推荐 Test Agent 与 Implementation Agent 修改不同目录：

```text
Implementation → src/...
Test           → tests/...
```

如果测试需要接口尚未冻结，先等 Implementation Agent 输出接口。

---

## Review Agent

默认只读。

检查：

```text
是否越界
架构边界
生命周期
错误处理
测试覆盖
是否提前实现后续能力
```

Review Agent 不直接修代码；返回 issues，由主 Agent 决定是否分配 fix task。

---

## Spike Agent

用于技术不确定性：

```text
S0 compatibility
SQL Language Server 选择
DAP reuse
性能验证
```

Spike Agent 输出结论/ADR，不做大范围正式架构实现。

---

# 2. 推荐并行点

## S0

```text
S0-04 SQL Grammar/WASM
        ╲
         并行（不同文件）
        ╱
S0-06 Minimal LSP
```

S0-01/02/03 不建议并行，因为依赖 package/runtime 基线。

---

## M1

第一组：

```text
M1-01 Language Registry
M1-02 Worker Protocol
```

可以并行。

第二组：

```text
M1-04 DocumentSession
M1-07 EditCodec/Test
```

在协议冻结后可以并行。

不要并行：

```text
M1-08 Incremental Parse
M1-09 Full Resync
```

后者依赖前者。

---

## M2

在 QueryManager/Capture DTO 稳定后：

```text
Highlight
Folding
Selection
```

可以分给三个子 Agent，因为 Provider 文件边界清晰。

---

## M2.5

在 URI Contract 冻结后：

```text
WorkspaceStore
Backend FileStore
```

可并行。

Dirty Overlay 依赖 Monaco binding，不要提前并行。

---

## M3

协议冻结后：

```text
Gateway WebSocket transport
Process lifecycle
Security tests
```

可以分开，但主 Agent 必须最终统一 integration。

SQL Dialect/LS 选择适合独立 Spike Agent。

---

## M4

最适合并行：

```text
TypeScript Agent
Python Agent
Formatter Agent
```

前提：三者禁止修改核心 Engine；共享配置冲突由主 Agent 集成。

---

# 3. 子 Agent Prompt 模板

```text
你是当前项目的子 Agent。

Task ID: <TASK-ID>

只处理这个任务，不进入后续任务。

目标：
<2-3 句话>

允许修改：
- <path>
- <path>

禁止修改：
- <path/core module>
- package versions（除非任务明确允许）

实现：
<几句话>

验证：
- <command/test>
- <command/test>

完成后只返回：
1. 修改文件
2. 实现摘要
3. 验证结果
4. 未解决问题

不要自动继续下一任务。
```

---

# 4. Main Agent 分配示例

```text
Create implementation agent:
  Task M2-07 Folding
  owns src/editor/adapters/folding.ts

Create implementation agent:
  Task M2-08 Selection
  owns src/editor/adapters/selection-range.ts

Create test/review agent:
  read-only review Query/Capture interfaces
```

等子 Agent 完成后，主 Agent：

```text
review diff
→ resolve integration conflicts
→ run full phase tests
→ mark PASS/FAIL
```

---

# 5. 不要这样并行

错误：

```text
Agent A: 重构 TreeSitterEngine
Agent B: 同时实现 Incremental Parse
Agent C: 同时实现 QueryManager
```

因为 B/C 都依赖 A 尚未冻结的接口。

错误：

```text
Agent A/B/C 同时修改 package.json
```

错误：

```text
让每个 Agent 自己选择不同版本的 Monaco/Tree-sitter
```

所有依赖版本必须由 S0 冻结，后续 Agent 只消费。

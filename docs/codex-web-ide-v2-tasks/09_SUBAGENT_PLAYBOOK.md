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

## Implementation Agent

只负责一个明确模块。输入必须包含：Task ID、目标、允许修改路径、现有接口、验证要求、禁止事项。

## Test Agent

负责测试用例、边界条件、回归验证。优先与 Implementation Agent 修改不同目录；接口未冻结时不要提前写依赖实现细节的测试。

## Review Agent

默认只读。检查越界、架构边界、生命周期、错误处理、测试覆盖、是否提前实现后续能力。

## Commit Agent

完整功能 PASS 后检查 diff、整理 commit、push；不得把多个无关 Task 合并成大提交。

---

# 2. M1 推荐并行点

详细依赖以 `m1/00_M1_EXECUTION_INDEX.md` 为准。

允许：

```text
M1-01 Registry/Test Foundation || M1-02 Protocol
M1-04 Session tests || M1-08 EditCodec（协议已冻结）
M1-06 Supervisor Core || M1-08 EditCodec
M1-12 Recovery || M1-13 Inspector（M1-11 PASS 后）
```

禁止：

```text
Protocol 未 PASS -> Client / Runtime
DocumentSession 未 PASS -> Incremental Parse
Incremental 未 PASS -> Full Resync
Full Resync 未 PASS -> Monaco Binding
Monaco Binding 未 PASS -> Recovery
```

文件 ownership 必须分离；两个 Agent 不得同时修改 `protocol.ts`、`document-manager.ts`、`client.ts` 等核心接口文件。

---

# 3. 其它阶段推荐并行点

## M2

QueryManager/Capture DTO 稳定后，Highlight / Folding / Selection 可分给三个 Agent。

## M2.5

依赖关系必须保持单一 WorkspaceFileSystem 模型：

```text
W-01 WorkspacePath / URI Contract
              ↓
W-02 WorkspaceFileSystem Contract
              ↓
      ┌───────┴────────┐
      │                │
W-03 Backend FS   W-04 Remote FS / API
      └───────┬────────┘
              ↓
W-05 Monaco + Dirty Overlay
              ↓
W-06 Operations Lifecycle
              ↓
W-07 Backend Visibility
              ↓
W-08 Integration Gate
```

W-03 Backend adapter 与 W-04 Remote/API adapter 只有在 W-02 接口冻结后才能并行。不得再拆成 `WorkspaceStore` / `FileStore` 两套 persisted storage；Dirty Overlay 不提前并行。

## M3

协议冻结后，Gateway transport / process lifecycle / security tests 可拆分；SQL LS 选择适合独立 Spike Agent。

## M4

TypeScript / Python / Formatter 可并行，前提是禁止修改核心 Engine。

---

# 4. 子 Agent Prompt 模板

```text
你是当前项目的子 Agent。

Task ID: <TASK-ID>
只处理这个任务，不进入后续任务。

目标：
<2-3 句话>

允许修改：
- <path>

禁止修改：
- <core path>
- package versions（除非任务明确允许）

验证：
- <command/test>

完成后只返回：
1. 修改文件
2. 实现摘要
3. 验证结果
4. 未解决问题
```

---

# 5. Main Agent 集成规则

子 Agent 完成后：

```text
review diff
-> run task validation
-> fix findings
-> Commit Agent
-> git push
-> only then unlock dependent task
```

禁止多个 Agent 自行选择不同依赖版本；S0 冻结的版本只能消费，不能顺手升级。

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

依赖关系：

```text
M2-01 Query Asset Decision / Manifest
              ↓
M2-02 sync-language-assets.mjs
              ↓
M2-03 verify-language-assets.mjs
          ┌───┴────────────────┐
          ↓                    ↓
M2-04 QueryManager      M2-05 Capability Protocol / DTO

M2-04 + M2-05 → M2-06 Highlight
M2-04 + M2-05 → M2-07 Folding
M2-05         → M2-08 Selection

M2-06 + M2-07 + M2-08
              ↓
        M2-09 Integration Gate
```

并行规则：

- `M2-04` 与 `M2-05` 只有在 M2-03 PASS 后、且文件 ownership 分离时并行。
- `M2-05` 修改 `protocol.ts` / `client.ts` 时，其他 Agent 不得同时修改这些文件。
- `M2-06` 与 `M2-07` 必须等待 `M2-04 + M2-05 PASS`，之后可按 Worker service / Monaco adapter ownership 分开并行。
- `M2-08` 只依赖 M2-05 的 capability contract，可与 M2-06/M2-07 并行，但不得重新定义 DTO。
- Asset Pipeline / Validation Agent 不碰 Worker runtime；Provider Agent 不修改 asset sync/lock。

禁止：

```text
Query asset 未验证 -> QueryManager
Capability Protocol 未 PASS -> Monaco Provider 直接碰 Tree-sitter
多个 Agent 自定义不同 SyntaxToken/Folding/Selection DTO
Highlight 请求无界堆入 Worker FIFO
```

## M2.5

依赖关系必须保持单一 WorkspaceFileSystem 模型：

```text
W-01 WorkspacePath / URI Contract
              ↓
W-02 WorkspaceFileSystem Contract
              ↓
      ┌───────┴────────┐
      ↓                ↓
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

W-03 与 W-04 必须共享 W-01 冻结的 WorkspacePath fixtures / security contract，不能各自实现不同 normalization。Backend Security/Test Agent 可独立补 traversal、authorization、symlink escape fixtures，但不要改 frontend contract。

## M3

协议冻结后，Gateway transport / process lifecycle / security tests 可拆分；SQL LS 选择适合独立 Spike Agent。

## M4

TypeScript / Python / Formatter 可并行。允许各语言修改独立 config/asset/mapping 和集中式 composition registration；禁止为了某语言修改通用 Tree-sitter runtime / Worker Protocol。

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

---

# 6. Vite+ Validation Task Workflow

Validation 流程由 Vite+ `0.3.0` 和 `vite.config.ts` 中的项目 Task 统一维护。Agent 不临时生成标准验证命令序列。

Implementation Agent 完成实现后：

```text
按需 vp check --fix
        ↓
vp run validate
或任务文档指定的专项 VP Task
        ↓
FAIL → Implementation/Test Agent 修复 → 重跑同一个 VP Task
        ↓
PASS → Review Agent → 代码有修改则重跑同一个 VP Task
        ↓
vp staged → commit → push
```

职责约定：

- Implementation Agent 负责代码、局部开发测试和必要的 fix，不重复运行完整 Phase Gate。
- Main Agent 负责调度一个确定的 VP Validation Task，读取 exit code/执行 summary、Review Gate、commit/push 和解锁后续 Task。不自行拼接 format/lint/typecheck/unit/build/preview。
- Test Agent 只用于编写测试、复杂失败诊断或独立 Phase Final 验证，不创建只运行 `vp run validate` 的 Agent。
- Review Agent 继续检查 P0/P1、架构边界、生命周期、资源泄漏、stale correctness 和 scope；程序化 Gate 不能替代 Review。

默认入口是：

```bash
vp run validate
```

有额外业务验证时，只能执行已经实现并接入 `vite.config.ts` 的专项 Task。当前 M2 assets verifier 与 `tests/m2` 已实现，正式专项入口为：

```text
verify:language-assets  → M2 language assets verifier
verify:m2               → M2 Phase Final Gate
```

M2 Phase Final 固定入口为：

```bash
pnpm install --frozen-lockfile
vp run verify:m2
```

Phase Final Gate 的目标保持：

```text
install once
check once
unit once
tsc once
build once
preview once
phase regressions once
cleanup once
```

M2 Final Gate 直接在同一 production preview 上运行 S0/M1/M2 regression suites，不通过 `verify:s0 → verify:m1 → verify:m2` 这种嵌套关系重复 build/preview。S0/M1 sealed verifier 保持不变。失败时优先读取 VP Task exit code 和 execution summary，必要时再分析失败 Task 的输出。

# 00 — Codex 全局执行规则

这些规则适用于所有任务。

## 1. 只处理当前任务

收到一个 Task ID 后：

- 只实现该任务。
- 不顺手实现后续能力。
- 不做大规模无关重构。
- 不升级无关依赖。
- 不改变已经冻结的架构边界。

如果发现后续问题，只记录在结果里，不提前处理。

---

## 2. 稳定优先

核心依赖原则：

```text
不追 latest
不使用 next / beta / canary
不使用 ^ / ~ 漂移核心依赖
pnpm-lock.yaml 必须保留
```

未经当前任务要求，不升级：

```text
monaco-editor
monaco-languageclient
@codingame/monaco-vscode-api
web-tree-sitter
tree-sitter-cli
TanStack Start / Router / Vite
```

---

## 3. 架构边界

必须保持：

```text
TanStack Start = Application Shell
Monaco         = Editor Platform
Workspace      = Project Source of Truth
Tree-sitter    = Syntax / Structure
LSP            = Semantic
DAP            = Debug
```

禁止：

- SQL 专用 `TreeSitterEngine`。
- 业务层直接依赖 `SyntaxNode` / `QueryCapture`。
- 自己重新实现 Grammar。
- 自己重新实现 Language Server。
- 自己重新实现 Debug Adapter。
- 把 LSP/DAP 长期进程塞进一次性 Server Function。
- 将 Worker 当作用户代码 Source of Truth。

---

## 4. 每个任务的固定执行循环

```text
1. Inspect
2. Implement
3. Validate
4. Fix current-task failures
5. Summarize
6. Stop
```

### Inspect

先检查当前仓库状态：

```text
相关目录
package.json
lockfile
现有测试
现有接口
当前任务依赖
```

不要基于假设直接改代码。

### Implement

只改当前任务允许的模块。

### Validate

至少执行：

- 当前任务的单测/集成测试。
- TypeScript 类型检查。
- 必要的 lint。
- 当前任务要求的 build/E2E。

### Stop

验证完成后停止，不进入下一 Task。

---

## 5. 修改范围

如果任务给出了 `允许修改`：

- 优先限制在这些路径。
- 必须修改额外路径时，在最终汇报里解释原因。
- 不允许大范围格式化整个仓库。

---

## 6. 子 Agent 冲突规则

两个实现 Agent 不允许同时修改同一个核心文件。

以下情况适合并行：

```text
Implementation Agent → src/module/*
Test Agent           → tests/module/*
Review Agent         → read-only
```

以下情况不适合并行：

```text
两个 Agent 同时改 package.json
两个 Agent 同时改同一个 protocol.ts
一个 Agent 尚未冻结接口，另一个 Agent 已依赖该接口实现
```

---

## 7. 每个任务最终汇报格式

```markdown
## Result

Status: PASS | BLOCKED | FAIL

### Changed

- file
- file

### Implemented

- ...

### Validation

- `command` → PASS/FAIL

### Notes

- ...

### Follow-ups

- 只记录，不实现
```

如果 `Status != PASS`，不要开始下一任务。

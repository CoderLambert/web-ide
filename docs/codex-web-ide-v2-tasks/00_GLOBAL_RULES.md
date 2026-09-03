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

### 执行文档优先级

主 V2 文档负责长期架构方向，当前阶段任务文档负责可执行细节。若任务编号、依赖、DTO、脚本名或阶段实现细节出现冲突，执行优先级固定为：

```text
当前阶段任务文档
  > 08_REVIEW_GATES.md
  > TASK_INDEX.md / 09_SUBAGENT_PLAYBOOK.md
  > 主 V2 文档中的概念示例
```

不要把不同版本的示例拼接成新的实现。发现冲突时先修文档，不自行扩大实现范围。

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
Workspace      = Project/File Domain
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

### Web-first 架构边界（冻结）

当前实现只服务 Web 当前需要的能力。Desktop / Neovim 只用于未来架构边界检查，不提前实现跨平台 Runtime。

禁止提前建设：

- `UniversalPlatform`
- `UniversalEditor`
- `UniversalTreeSitterEngine`

后续阶段必须遵守：

- Backend Workspace Filesystem 的 persisted file content 是唯一 Source of Truth；Monaco 只表示 open document / dirty overlay，Database 只保存 workspace metadata。
- Domain / Workspace Core 优先使用 `WorkspacePath`，例如 `src/main.ts`。
- Monaco / Syntax / LSP 等需要 URI 的边界通过 `WorkspaceUriMapper` 生成 canonical URI，例如 `file:///workspace/src/main.ts`。
- Backend host path 只能存在于 `BackendWorkspaceFileSystem` / deployment adapter 内，不得进入 Browser、Domain、Protocol 或其他上层类型。
- Semantic / LSP 上层依赖 transport boundary，不把当前 WebSocket 实现写死为上层 API。
- 当前只实现 Web 所需的 Remote/Backend Workspace Filesystem adapter；不为 Desktop stdio 或 Neovim adapter 预留超出当前 Web 需求的实现。
- Tree-sitter Query、`SyntaxNode`、`Tree`、`QueryCapture` 只存在于 Syntax Worker / adapter 内；跨 Worker 与 Provider 边界只传版本化、可序列化的项目 DTO。

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

---

## 8. Vite+ Validation Workflow

项目固定使用已安装的 Vite+ `0.3.0`。Agent 不升级 Vite+，也不为标准验证流程自建 runner、scheduler、cache 或 hook manager。

标准静态检查和单元测试由项目 `vite.config.ts` 中的 Validation Task 统一编排：

```bash
vp check
vp test
vp run validate
```

普通开发 Task 默认执行：

```bash
vp run validate
```

Agent 可以在实现阶段按需执行 `vp check --fix`。Validation Task、`vp staged` 和 commit hook 只验证，不使用 `--fix`，不自动 `git add`，不修改源码。

专项验证只有在对应 verifier 已实现并接入 `vite.config.ts` 后，任务文档才允许调用对应 VP Task。当前不注册 M2 专项入口：

```text
verify:language-assets  → M2 assets verifier 实现后再接入
verify:m2               → M2 assets verifier 与 tests/m2 实现后再接入
```

Phase Final Gate 的目标是一次 install、一次 check、一次 unit、一次兼容性 `tsc --noEmit`、一次 build、一次 preview、一次阶段回归和一次 cleanup。M2 Phase Gate 尚未启用；不得把不存在的 Phase Gate 当作当前可用入口，也不得把 `verify:s0`、`verify:m1` 互相嵌套来重复 build/preview。S0/M1 sealed verifier 保持不变，未来阶段在真实 verifier 和测试存在后再接入 preview lifecycle。

Main Agent 负责选择并执行确定的 VP Validation Task、读取 exit code/summary、处理失败和触发 Review；不手工重新组合 format/lint/typecheck/unit/build/preview 序列。需要查看最近一次任务详情时使用：

```bash
vp run --last-details
```

# 03 — M2 Syntax UX

进入条件：`M1 PASS`。

目标：在稳定 Syntax Foundation 上实现 Query、高亮、Folding 和 Selection。

---

# M2-01 — Query Asset Manifest

## 目标

把 Query 来源变成可追踪、可 pin 的独立资产。

## 实现

每个 `highlights/folds/injections/locals` 独立记录 repository、revision、path、patches。不要假设所有 Query 来自同一 commit。

## 允许修改

```text
src/language/*
src/languages/sql/*
```

## 验证

SQL manifest 能明确输出每种 Query 的来源。

## 不要做

- 不下载 Query。
- 不实现 Query runtime。

---

# M2-02 — sync-language-assets

## 依赖

`M2-01 PASS`

## 目标

在构建期同步 pinned Query，并应用项目 patch。

## 实现

`scripts/sync-language-assets.ts` 负责：

```text
fetch/copy pinned asset
→ apply patch
→ write local artifact
```

运行时不负责 Neovim Query 兼容转换。

## 验证

clean 环境重复运行得到相同 Query 产物。

## 不要做

- 不调用 Monaco。
- 不实现 capture mapping。

## 可分配子 Agent

Asset Pipeline Agent 可以独立实现该脚本。

---

# M2-03 — verify-language-assets / Query Compile

## 依赖

`M2-02 PASS`

## 目标

CI 在运行应用前发现 Grammar/Query 不匹配。

## 实现

创建验证脚本：

```text
load pinned grammar
compile each query
verify expected capture classes
```

失败必须返回非 0 exit code。

## 验证

故意写一个 invalid node type，CI 验证应失败。

## 可分配子 Agent

Validation Agent 独立负责，不修改 sync 脚本。

---

# M2-04 — QueryManager

## 依赖

`M2-03 PASS`

## 目标

Worker 加载、编译并缓存已经构建期验证的 Query。

## 实现

LanguageRuntime 按需加载 Query，缓存 compiled query；切换/释放语言时正确 dispose。

## 验证

重复请求同一 Query 不重复编译；编译错误转结构化状态。

## 不要做

- 不写 Highlight Provider。
- 不模拟完整 nvim runtime。

---

# M2-05 — CaptureNormalizer

## 依赖

`M2-04 PASS`

## 目标

上层只消费稳定 DTO，不依赖 Tree-sitter QueryCapture。

## 实现

转换成：

```ts
interface SyntaxCapture {
  name: string;
  range: EditorRange;
  priority?: number;
}
```

## 验证

SQL highlights query 输出可预测的 normalized captures。

## 可分配子 Agent

可与 Provider UI 准备工作并行，但不要让其他 Agent 自定义新的 capture DTO。

---

# M2-06 — HighlightCoordinator + Semantic Highlight

## 依赖

`M2-05 PASS`

## 目标

Tree-sitter 成为第一阶段唯一 Semantic Token Owner。

## 实现

```text
Tree-sitter captures
→ HighlightCoordinator
→ Monaco DocumentSemanticTokensProvider
```

保留 Monaco baseline tokenizer；不启用 LSP Semantic Tokens。

## 验证

SQL keyword/string/comment/function-like captures 正常高亮；快速输入后 token version 不回退。

## 不要做

- 不合并 LSP Semantic Tokens。
- 不做主题系统重构。

---

# M2-07 — Folding Provider

## 依赖

`M2-04 PASS`

可与 `M2-06` 并行。

## 目标

利用 `folds.scm` 实现 Monaco Folding。

## 实现

Query capture → normalized folding range → Monaco FoldingRangeProvider。

## 允许修改

```text
src/editor/adapters/folding.ts
相关 query adapter
相关 tests
```

## 验证

典型多行 SELECT / subquery 可折叠；非法 SQL 不导致 provider crash。

---

# M2-08 — Selection Range

## 依赖

`M1 PASS`

可与 `M2-06/M2-07` 并行。

## 目标

使用 AST parent chain 实现结构化 Expand Selection。

## 实现

从当前位置找到最小节点并逐级返回 parent ranges。不要依赖 SQL Domain Model。

## 验证

```text
identifier
→ expression
→ select item
→ select statement
```

选择范围单调扩大且合法。

---

# M2-09 — M2 Integration Gate

## 依赖

全部 M2 task PASS

## 验证

```text
Query asset reproducible
Query compile CI
Highlight
Folding
Selection
快速编辑
invalid SQL
route remount
worker recovery 后 Query 能重新工作
```

## Stop Rule

M2 未通过，不进入 Workspace/LSP。

# 03 — M2 Syntax UX

进入条件：`M1 PASS`。

目标：在已经封板的 Syntax Foundation 上实现 Query、高亮、Folding 和 Selection，不重新打开 M1 架构。

本文件是 M2 的可执行 Source of Truth。主 V2 文档中的 Query / Capture 示例只作为长期架构说明；若与本文件的任务依赖、DTO、脚本名或 Worker 边界冲突，以本文件为准。

## M2 冻结原则

```text
Tree-sitter Query / Tree / SyntaxNode / QueryCapture
= Worker 内部实现细节

跨 Worker / Provider 边界
= versioned project DTO only

Monaco
= Provider/UI adapter
```

同时保持：

- M1 的单 Worker、每语言单 Parser、全局 FIFO 不变。
- 不因为 M2 提前引入 Worker Pool、Parser Pool、优先级 Scheduler。
- Derived capability 请求必须 bounded；旧版本结果直接丢弃，不能刷新 Monaco。
- 第一阶段 Tree-sitter 是唯一 Semantic Token Owner；LSP Semantic Tokens 继续关闭。
- Query 资产必须 pinned、可追踪、可离线验证；应用正常 build/runtime 不访问上游仓库。
- `web-tree-sitter 0.25.10` 继续保持冻结，只有可重复的真实兼容/资源问题才能触发升级评估。

## M2 Validation Workflow

普通 M2 Task 的标准项目验证统一执行：

```bash
vp run validate
```

当前 `validate` 已统一编排 `vp check` 与 `vp test run tests/unit`。Agent 不再自行组合 `pnpm lint`、`pnpm typecheck`、`pnpm check`、`pnpm test:unit` 等标准工具链命令；Validation 与 pre-commit 都必须保持 non-mutating。

Task 自身的行为测试优先进入 `tests/unit`，由公共 `vp run validate` 统一覆盖。真正独有的业务 verifier 由对应 Task 明确注册后才能调用。

本次只调整验证执行方式，不改变 M2-01 → M2-09 dependency graph、M1 sealed architecture 或既有 correctness requirements。

---

# M2-01 — Query Asset Decision / Manifest

## 目标

只为当前 M2 实际需要的 Query 建立可追踪、可 pin 的资产清单，不假设 Grammar 自带所有 Query，也不假设“能 compile”就代表不同 runtime 下行为完全兼容。

## 已确认事实

当前冻结的 SQL Grammar revision `7b51ecda191d36b92f5a90a8d1bc3faef1c7b8b8` 自带：

```text
queries/highlights.scm
queries/indents.scm
```

当前 revision **不提供**：

```text
folds.scm
injections.scm
locals.scm
```

M2 当前只要求：

```text
highlights
folds
```

`injections` / `locals` 只保留为未来 optional capability，不同步、不编译、不实现。

SQL folding 的已知成熟候选：

```text
repository: nvim-treesitter/nvim-treesitter
revision: cf12346a3414fa1b06af75c79faebe7f76df080a
path: queries/sql/folds.scm
license: Apache-2.0
content: (statement) @fold
```

它只是候选。必须在 M2-03 对当前 pinned SQL Grammar 编译并用真实 folding fixture 验证后才能正式接受；不能仅因来源成熟就跳过兼容性验证。

### 已知 Highlight Predicate 兼容点

当前 pinned `highlights.scm` 的 number / float `#match?` pattern 使用 `%d`。`web-tree-sitter 0.25.10` Web binding 对 `match?` 使用 JavaScript `RegExp` 执行，因此该 pattern 不能仅凭 Query compile 判断行为正确。

M2 必须把它视为一个 **build-time compatibility patch**：保留上游原始 provenance，只在本项目 vendored artifact 上应用最小 predicate patch，并用 M2-03 的真实 query execution fixture 证明 integer / float capture 正确。不要为此更换 Grammar 或升级 runtime。

## 实现

为每个实际使用的 Query 独立记录：

```text
kind
repository
revision
path
license
local artifact path
patches（可选）
```

不同 Query 可以来自不同 repository/revision。

来源优先级：

```text
Grammar 官方 Query
→ 成熟编辑器生态 Query
→ 最小 project patch
```

## 允许修改

```text
src/language/*
src/languages/sql/*
相关 asset manifest / lock docs
```

## 验证

- highlights 来源明确指向当前 pinned SQL Grammar。
- folds 来源明确且带 license/provenance。
- predicate compatibility patch 有明确来源和测试目标。
- manifest 不伪造 `injections` / `locals`。

## 不要做

- 不下载 Query。
- 不实现 Query runtime。
- 不自己重新设计 SQL folding grammar。
- 不因为 predicate 差异升级 Grammar / `web-tree-sitter`。

---

# M2-02 — sync-language-assets.mjs

## 依赖

`M2-01 PASS`

## 目标

提供显式维护命令，将 pinned Query 同步成仓库内的本地 artifact，并应用最小、声明式的 runtime compatibility / project patch。

## 命令边界

`scripts/sync-language-assets.mjs` 是 **mutating maintenance command**，负责：

```text
fetch/copy pinned source
→ apply patch
→ 更新 vendored artifacts
```

它不是项目 Validation。禁止把它接入 `vp run validate`、`vp staged`、pre-commit 或 normal Phase validation；标准 Validation 必须 non-mutating。

## 实现

使用现有 Node ESM 工具风格：

```text
scripts/sync-language-assets.mjs
```

流程：

```text
fetch/copy pinned source
→ verify revision/path provenance
→ apply declared compatibility/project patches
→ write deterministic local artifact
```

同步后的 Query artifact 必须提交到仓库。正常：

```text
pnpm build
production preview
Worker runtime
```

都只消费本地 artifact，不访问 GitHub / 上游网络。

第三方 Query 必须保留 repository/revision/license attribution；如果许可证要求随分发附带 notice/license，则沿用或建立项目统一的 third-party notice 机制，不把许可信息散落在 runtime 代码里。

## 验证

- clean 环境重复执行得到 byte-identical Query artifact。
- 未声明的上游变化不会静默进入仓库。
- SQL numeric/float predicate compatibility patch 可重复应用。
- patch 失败返回非 0。

## 不要做

- 不调用 Monaco。
- 不实现 capture mapping。
- 不为了运行 `.ts` script 新增 `tsx` / `ts-node`。
- 不把网络同步放进普通 application build。

## 可分配子 Agent

Asset Pipeline Agent 可以独立实现该脚本。

---

# M2-03 — verify-language-assets.mjs / Query Compatibility Gate

## 依赖

`M2-02 PASS`

## 目标

在 Provider 和 Query runtime 开发前，离线证明本地 Query artifact 与 pinned Grammar **编译兼容且执行语义正确**。

`scripts/verify-language-assets.mjs` 是 **non-mutating project verifier**，只读取本地 pinned grammar/query artifact 并返回验证结果，不修改源码、vendored artifact 或 `node_modules`。

## 实现

建立：

```text
scripts/verify-language-assets.mjs
```

第一层：

```text
load pinned local grammar WASM
→ compile local highlights query
→ compile local folds query
→ verify expected capture classes
```

第二层必须真实 parse + execute Query，至少覆盖：

```text
SELECT / FROM keyword      → keyword capture
'text' literal             → string capture
123 integer                → number capture
1.25 float                 → numeric/float capture
-- comment                 → comment capture
function invocation        → function-like capture
multiline statement        → @fold capture
```

这里验证的是当前 `web-tree-sitter 0.25.10` 的实际执行结果，不接受“Query 构造成功”替代 behavior test。

失败必须返回非 0。

## Vite+ 专项 Task 注册

只有 M2-03 完成 `verify-language-assets.mjs` 后，才允许同时修改 `vite.config.ts`，注册正式专项 Vite+ Task：

```bash
vp run verify:language-assets
```

该 Task 的逻辑必须是：

```text
base validation
→ verify-language-assets.mjs
```

可使用当前固定 Vite+ `0.3.0` 支持的 `dependsOn` 表达 `validate` → verifier 的复用关系；不要为了更漂亮的配置升级 Vite+。M2-03 的最终验证入口必须包含 `vp run verify:language-assets`，但专项 Task 不能替代下列 correctness requirements：

```text
offline grammar/query load
query compile
real parse + execute
keyword/string/integer/float/comment/function fixture
folding fixture
numeric predicate regression
invalid node type failure
```

## 验证

- 当前 pinned + patched artifacts PASS。
- 去掉 numeric predicate compatibility patch 后，对应 behavior fixture 必须能暴露错误。
- 故意写 invalid node type 时 compile validation FAIL。
- 不依赖网络即可执行。

## 可分配子 Agent

Validation Agent 可独立负责，不修改 sync 脚本。

---

## M2-04～M2-08 统一执行规则

这些普通 M2 Task 完成实现后，标准项目 Gate 统一执行：

```bash
vp run validate
```

Implementation Agent 可按需运行局部测试和 `vp check --fix`；Main Agent 负责调用确定的 VP Task，不重新手工组合 format/lint/typecheck/unit 等命令。各 Task 已定义的行为验证继续保留，例如：

```text
Query compile retry / Query dispose / Worker recovery
protocol runtime decoder / stale rejection
Highlight bounded queue
Folding invalid SQL
Selection Unicode / emoji / CRLF
```

这些是 correctness requirements，不是重复的工具链命令，不能删除或用公共 `validate` 的描述替代。

---

# M2-04 — QueryManager / Query Lifecycle

## 依赖

`M2-03 PASS`

可与 `M2-05` 在文件 ownership 分离后并行。

## 目标

Worker 按语言按需加载、编译和缓存已经通过构建期验证的 Query，并把 Query 生命周期绑定到 `LanguageRuntime` / Worker 生命周期。

## 实现

最小规则：

```text
same language + query kind
→ compile once

compile failure
→ 不永久污染 cache，可 retry

Worker recovery
→ Query 从本地 artifact 重建

LanguageRuntime / Worker dispose
→ compiled Query dispose
```

不建立跨 Worker、跨语言的全局 Query cache。

## 验证

- 重复请求同一 Query 不重复编译。
- compile failure 后修复输入可以 retry。
- Worker recovery 后 Query 能重新工作。
- 重复 open/close document 不增加 Query 实例。
- runtime dispose 后 Query resource 被释放。

针对当前冻结的 `web-tree-sitter 0.25.10` 做真实 compile/execute/dispose/resource 回归；只有出现可重复问题才允许提出版本升级或 workaround。

## 不要做

- 不写 Monaco Provider。
- 不模拟完整 nvim runtime。
- 不升级 `web-tree-sitter`。

---

# M2-05 — Syntax Capability Protocol / Stable DTO

## 依赖

`M2-03 PASS`

可与 `M2-04` 并行，但不能与其它 Agent 同时修改 `protocol.ts` / `client.ts`。

## 目标

正式冻结 Highlight / Folding / Selection 跨 Worker 边界。Provider 只能消费项目自己的稳定 DTO，不能拿 Tree-sitter Query/AST 对象。

## 实现

M2 此时已经有 Worker Protocol 与 Provider 两个明确消费者，因此允许做一次小型 DTO 提取：将 M1 已有 `TextPosition` / `TextRange` 放到项目 Syntax DTO 模块（例如 `src/syntax/types.ts`），现有 Tree-sitter protocol 继续 re-export，保持 M1 调用兼容。不要借此移动其它 M1 类型或重构 Protocol。

新增明确 capability request/result，而不是通用 `QueryCapture[]` transport：

```text
GetHighlights        → HighlightsResult
GetFoldingRanges     → FoldingRangesResult
GetSelectionRanges   → SelectionRangesResult
```

所有 request 至少携带：

```text
sessionId
documentUri
expectedVersion
```

所有 result 至少携带：

```text
sessionId
documentUri
documentVersion
```

使用项目 DTO，例如：

```ts
interface SyntaxToken {
  range: TextRange;
  type: SyntaxTokenType; // project-owned vocabulary, not raw @capture name
}

interface SyntaxFoldingRange {
  range: TextRange;
}

interface SyntaxSelectionPath {
  ranges: TextRange[]; // inner → outer
}
```

`SyntaxTokenType` 只冻结 SQL 当前需要的最小项目词汇；上游 `@function.call`、`@field`、`@type.builtin`、`@float` 等 capture name 必须在 language-specific Worker adapter 内映射，不能直接成为业务 API。重复/重叠 capture 的决策也在 Worker normalizer 内完成，不向 Monaco 暴露 Query 排序细节。

Selection request 应允许一次携带 Monaco 当前需要的一组 position，并返回顺序对应的 selection paths；不得返回 `SyntaxNode` 或 AST Inspector DTO。

Derived capability 请求如果 `expectedVersion !== current session version`，必须作为 stale/version mismatch 处理，不触发 Full Resync。

## 验证

- runtime decoder 覆盖所有新 message。
- unknown/missing/invalid field 被拒绝。
- stale generation/session/version result 不被 client 消费。
- M1 protocol 现有调用在 DTO 提取后保持兼容。
- main thread / Provider 代码无法拿到 `Tree` / `SyntaxNode` / `QueryCapture`。

## 不要做

- 不新增通用 `RunQuery` / `GetQueryCaptures` API。
- 不让 Protocol 引用 Monaco 类型。
- 不用 AST Inspector 作为正式 Provider transport。
- 不实现 cancel protocol、Worker scheduler 或 priority queue。

---

# M2-06 — HighlightCoordinator + Semantic Highlight

## 依赖

`M2-04 PASS`, `M2-05 PASS`

## 目标

Tree-sitter 成为第一阶段唯一 Semantic Token Owner，通过稳定 `SyntaxToken[]` 驱动 Monaco。

## 实现

Worker 内：

```text
SQL highlights query
→ raw QueryCapture
→ SQL capture mapping / overlap normalization
→ SyntaxToken[]
```

Main thread：

```text
HighlightsResult
→ HighlightCoordinator
→ Monaco DocumentSemanticTokensProvider
```

保留 Monaco baseline tokenizer；不启用 LSP Semantic Tokens。

### FIFO / Backpressure

M1 的 Worker 全局 FIFO 保持不变。HighlightCoordinator 必须做到：

```text
每 document 最多一个 highlight request in-flight
model version 改变 → 记录 latestVersion
旧 result 返回 → stale discard
期间出现多个新版本 → 只补一次 latestVersion request
```

禁止每次编辑无限追加 Highlight 请求到 Worker queue。

## 验证

- SQL keyword/string/comment/number/function-like 等映射到稳定项目 token type。
- M2-03 已验证的 integer / float predicate behavior 在 Worker runtime 中保持一致。
- 不认识的上游 capture 有明确 ignore/fallback 策略，不 crash。
- 快速输入后 token version 不回退。
- 连续编辑时 pending derived request bounded。
- Worker recovery 后 highlight 自动恢复。

## 不要做

- 不把 raw capture name 暴露给 Monaco adapter。
- 不合并 LSP Semantic Tokens。
- 不做主题系统重构。
- 不为性能假设引入增量 token diff / Worker Pool。

---

# M2-07 — Folding Provider

## 依赖

`M2-04 PASS`, `M2-05 PASS`

可与 `M2-06` 并行。

## 目标

通过已验证的 pinned folding Query 生成稳定 `SyntaxFoldingRange[]`，再适配 Monaco FoldingRangeProvider。

## 实现

```text
folds query
→ Worker raw @fold capture
→ SyntaxFoldingRange[]
→ Monaco FoldingRangeProvider
```

Provider 只消费 DTO。单行 range 应过滤；非法/不完整 SQL 不得导致 Provider crash。

如果 M2-01 选择的成熟 folds query 对真实 subquery fixture 不足，只允许添加最小、测试驱动的 local patch，并回到 M2-03 重新 compile/execute/verify；不要重新设计一套 SQL folding engine。

## 验证

- 多行 SELECT / statement 可折叠。
- 真实 subquery fixture 按 pinned query 能力验证；不足时有最小 patch 和回归测试。
- stale version result 不刷新 Provider。
- Worker recovery 后 folding 可重建。

---

# M2-08 — Selection Range

## 依赖

`M2-05 PASS`

可与 `M2-06/M2-07` 并行，前提是文件 ownership 分离。

## 目标

使用 Worker 内当前 Tree 的 parent chain 实现结构化 Expand Selection，并只返回 `SyntaxSelectionPath` DTO。

## 实现

```text
TextPosition[]
→ Worker current session tree
→ smallest node + parent chain
→ UTF-16 TextRange[]
→ SelectionRangesResult
→ Monaco SelectionRangeProvider
```

不依赖 SQL Domain Model，不序列化 AST，不经过 AST Inspector。

## 验证

```text
identifier
→ expression
→ select item
→ select statement
```

- 选择范围单调扩大且合法。
- Unicode / emoji / CRLF position 仍为 0-based UTF-16。
- stale version request/result 被丢弃，不触发 document resync。

---

# M2-09 — M2 Integration / Resource Gate

## 依赖

全部 M2 task PASS。

## 固定 Phase Final 入口

M2-09 才正式建立 `verify:m2` Vite+ Task。正式 Phase Final 的执行入口固定为：

```bash
pnpm install --frozen-lockfile
vp run verify:m2
```

这是一个逻辑 Phase Final Gate 的两个固定阶段：

```text
Bootstrap
→ Project Validation
```

不是让 Agent 自己决定执行顺序，也不能改回旧的手工 verifier 入口。

### Bootstrap

```bash
pnpm install --frozen-lockfile
```

只执行一次，负责：

```text
dependency installation
lockfile consistency verification
environment bootstrap
```

它属于环境 bootstrap，不属于 `verify:m2`。运行中的 VP Task 依赖项目依赖和 Vite+ 已经可执行，因此不得再负责安装或修改 `node_modules`；fresh environment 中 VP 尚不可执行时，也不能把安装 VP 所需依赖的职责放入 VP Task 内。

### Project Validation

```bash
vp run verify:m2
```

负责项目代码与 M2 capability 验收。只有在 `verify-language-assets.mjs` 与 `tests/m2` 已真实存在时，才允许在 `vite.config.ts` 注册该 Task。

`verify:m2` 的逻辑至少覆盖以下阶段，并保证相同基础步骤不重复执行：

```text
vp run validate
→ verify-language-assets
→ tsc --noEmit (compatibility check)
→ vp build
→ production preview
→ S0 regression / M1 regression / M2 E2E
→ resource diagnostics
→ cleanup
```

注册时优先复用当前固定 Vite+ `0.3.0` 支持的 Task composition：让 `verify:m2` 复用 `verify:language-assets` 的 Task dependency，再执行自身的 `tsc`、build、preview、regression 和 cleanup；这样 `vp run validate` 与 verifier 都只执行一次。`verify:language-assets` 的独立入口仍是 `vp run verify:language-assets`；在 `verify:m2` 中不要在已经复用该 dependency 后再次嵌套执行 base validation，以满足：

```text
check once
unit once
tsc once
build once
preview once
cleanup once
```

## 为什么 Phase Final 暂时保留 tsc

普通 Task 的 `vp run validate` 已通过 `vp check` 做标准 Vite+ type checking，因此不再由每个 Task 额外执行 `tsc --noEmit`。M2 Phase Final 暂时保留一次 `tsc --noEmit` 作为兼容性保护，原因是：

```text
当前仓库历史验证流程长期使用 tsc --noEmit
Vite+ type checking 与 tsc 的诊断实现并非必须完全等价
当前没有必要在 M2 开始前顺手删除这一保护
```

是否最终移除 tsc，在 M2 完成后根据实际验证数据单独评估；本任务不扩大范围。

## Production Preview 原则

M2 Final Gate 必须满足：

```text
vp build once
vp preview once
```

然后在同一个 production preview 上运行：

```text
tests/s0
tests/m1
tests/m2
```

禁止 `verify:s0 → verify:m1 → verify:m2` 这种嵌套关系，因为它会重复 install、check、build、preview。S0/M1 sealed verifier 保持原样；M2 Final Gate 复用 regression suites，而不是嵌套 sealed verifier。

## Preview lifecycle

只有当 `tests/m2` 已真实存在且 production Phase Gate 已真实存在时，M2-09 才允许增加最小 preview orchestration helper。helper 只负责：

```text
spawn vp preview
→ wait ready
→ run Playwright
→ cleanup on success
→ cleanup on failure
→ cleanup on timeout
```

不要建设 generic process framework、task runner、scheduler 或 plugin lifecycle system，也不要为了复用去重构 `verify-s0.mjs`、`verify-m1.mjs`。

## 必须验证

```text
Query asset reproducible / provenance pinned
Query compile + predicate behavior offline
Query compile failure 可 retry
Query dispose / Worker recovery rebuild
Highlight
Folding
Selection
快速编辑
invalid SQL
route remount
worker recovery
stale result rejection
derived request queue bounded
```

性能/资源使用 deterministic 100KB / 1MB SQL 做 diagnostics：

- capability request 完成且 Worker 不 crash。
- 快速连续编辑不出现无界 Highlight backlog。
- 不把机器相关 P95 直接设成硬失败阈值。
- 若出现真实瓶颈，先定位 Query execution / serialization / queue / Provider，再决定是否优化。

## Stop Rule

以下任一存在则 M2 FAIL：

```text
Raw QueryCapture / SyntaxNode / Tree 穿过 Worker 边界
Provider 直接依赖 Tree-sitter API
Query runtime 访问上游网络
Query 只 compile 未做当前 runtime predicate behavior 验证
stale capability result 刷新 Monaco
Derived requests 无界积压
Query resource 无法在 recovery/dispose 后释放或重建
为了未证明的性能问题升级 runtime / 引入 Worker Pool
LSP Semantic Tokens 与 Tree-sitter 同时成为 token owner
```

M2 未通过，不进入 Workspace/LSP。

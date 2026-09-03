# 08 — Review Gates

主 Agent 在每个阶段完成后执行一次独立 Review。推荐使用只读 Review Agent。

---

# S0 Review

检查：依赖精确锁定、production build、Worker/WASM、Monaco lifecycle、minimal LSP、ADR/runtime-lock。

---

# M1 Review

必须检查：

```text
语言无关
Syntax Core 不依赖 Monaco
Protocol 有 runtime validation
baseVersion/nextVersion 正确
Worker 全局 FIFO 且失败不 poison queue
multi document/session/version/generation 正确
incremental parse 有 Full Resync
Unicode/emoji/CRLF/batch edits 正确
Tree 生命周期/dispose 正确
pending request 在 restart 后清理
Worker recovery 不丢恢复期间编辑
close during recovery 不复活文档
AST Inspector bounded/on-demand
资源 Gate / performance baseline
S0 regression
```

M1 Stabilization 还必须确认：

```text
verify:m1 可重复执行并在 production preview 上运行 S0/M1 Playwright
benchmark 与 verify gate 分离，性能 P95 不是无证据的硬失败阈值
Recovery E2E 覆盖 real Worker、generation、snapshot restore、继续编辑和 close/dispose
Recovery 期间 pending request bounded 且不会因 restore response 误杀新 Worker
```

红线，任一存在则 M1 FAIL：

- SQL 专用 TreeSitterEngine。
- Worker 成为 Source of Truth。
- 上层直接拿 `SyntaxNode` / `Tree`。
- `src/syntax/**` import Monaco。
- ApplyChanges 没有 `baseVersion`。
- Worker async message 无 FIFO。
- `tree.edit()` 后失败仍继续使用该 Tree。
- 没有 Full Resync fallback。
- restart 后旧 pending request 泄漏。
- recovery 丢失用户编辑或复活已关闭 session。
- 普通 parse 热路径发送完整 AST。
- 未经性能证据引入 Rope / Worker Pool / Multiple Workers。

---

# M2 Review

重点：Query provenance、offline reproducibility、当前 Web runtime 下的 Query 执行兼容性、runtime lifecycle、稳定 capability DTO、版本一致性、derived request backpressure、单一 Semantic Token Owner、Folding/Selection Provider 边界。

必须检查：

```text
普通 M2 Task 使用已经定义的 Vite+ Validation Task：vp run validate
Agent 不重新手工组合 format/lint/typecheck/unit/build/preview
M2-02 sync-language-assets 保持 mutating maintenance command，不进入 normal validation/commit hook
M2-03 完成 verifier 后才注册 verify:language-assets
M2-09 仅在 assets verifier 与 tests/m2 真实存在后注册 verify:m2
Phase Final 先 bootstrap once，再 Project Validation
Phase Final check once / unit once / tsc once / build once / preview once / cleanup once
S0/M1/M2 共用同一 production preview
当前 SQL Grammar 实际只自带 highlights/indents，不伪造 folds/injections/locals
M2 只同步当前需要的 highlights + folds
folds 来源 repository/revision/path/license 可追踪并对 pinned grammar 编译/执行验证
第三方 Query provenance/license/patch 可追踪
sync-language-assets 是显式维护命令，normal build/runtime 不访问上游网络
verify-language-assets 可离线失败/成功复现
Query 不只 compile，还在当前 web-tree-sitter runtime 上执行 behavior fixtures
SQL highlights #match? numeric/float compatibility patch 有声明、有回归测试
same language + query kind 不重复 compile
compile failure 不永久 poison cache
Worker recovery 后 Query 可重建
dispose 后 compiled Query 释放
Highlight/Folding/Selection 使用 versioned request/result
raw QueryCapture/SyntaxNode/Tree 不跨 Worker 边界
upstream capture name 在 language-specific Worker adapter 映射成 project token vocabulary
Selection 使用 Worker parent chain，不复用 AST Inspector transport
stale result 不刷新 Monaco
derived capability request bounded，不无界占用 FIFO
100KB/1MB capability diagnostics 不导致 Worker crash/明显 backlog
```

红线，任一存在则 M2 FAIL：

- Provider 或业务层直接依赖 Tree-sitter `Query` / `QueryCapture` / `SyntaxNode` / `Tree`。
- 新增通用 `RunQuery` / `GetQueryCaptures` 让上层解释 raw capture。
- Query runtime 从 GitHub / 上游网络加载资产。
- 未验证就假定 SQL Grammar 自带 `folds.scm`。
- `injections` / `locals` 在当前没有使用场景时被提前实现。
- Query 只 compile，未验证当前 `web-tree-sitter` predicate behavior。
- SQL numeric/float predicate compatibility patch 没有行为测试。
- stale capability result 刷新 Monaco。
- 每次编辑持续追加 derived query，Worker queue 无界增长。
- Worker recovery/dispose 后 Query resource 泄漏或无法重建。
- 未经复现问题升级 `web-tree-sitter` 或引入 Worker Pool / Scheduler。
- Tree-sitter 与 LSP 同时成为第一阶段 Semantic Token Owner。
- M2 Final Gate 嵌套 `verify:s0` / `verify:m1`，导致重复 build / preview → `M2 FAIL`。
- 把 mutating `sync-language-assets` 放入标准 validation / commit hook → `M2 FAIL`。

---

# M2.5 Review

重点：WorkspacePath / canonical URI / host path 三层边界、WorkspaceFileSystem operation/error contract、Backend persisted filesystem、RemoteWorkspaceFileSystem、dirty/save race、rename/delete lifecycle、Backend read-after-save 一致性与 production integration gate。

冻结边界：

```text
Backend Workspace Filesystem = persisted file content Source of Truth
Monaco Model                 = open document / unsaved text buffer
Dirty State                  = dirty/version metadata
Database                     = workspace metadata
```

只实现薄 `WorkspaceFileSystem` boundary 和当前 Web adapter；不建设双 Source of Truth。Backend real path 不得进入 Browser / Domain / Protocol。

必须检查：

```text
one IDE shell = one active workspace
WorkspacePath root 用 "" 表示，且只允许 list("") 使用 root
非 root WorkspacePath 只用 /，禁止 absolute / trailing / // . .. backslash NUL
非法 WorkspacePath 被 reject，不做 normalization
transport decode 后重新执行 WorkspacePath validation；应用层不二次 decode
WorkspacePath 默认作为 JSON/structured field 传输，不依赖 URL path percent-decoding
WorkspacePath ↔ canonical URI round-trip 一致

一个 WorkspaceFileSystem instance = 一个 bound workspace
WorkspaceFileSystem 只处理 UTF-8 text capability
WorkspaceEntry 不承担 language detection
list/read/write/create/rename/delete 语义在 Backend/Remote 一致
writeFile 不隐式 create；rename 不 overwrite；delete 不 recursive
Workspace Core 不依赖 Node errno / HTTP status / fetch error

Workspace API 使用 workspaceId + WorkspacePath，不接受客户端 host root
workspaceId 不是授权凭证
Server boundary 先 authorize workspaceId，再 resolve server-owned root
BackendWorkspaceFileSystem 只消费 bound trusted root，不承担 Auth/RBAC
客户端不能提供/覆盖 Backend workspace root

symlink 第一版 unsupported / no-follow
中间 segment / target / create-rename parent 不能通过 symlink 逃逸 root
list 不暴露 unsupported symlink entry
path containment 不只检查字符串 ..，existing target / parent resolution 仍必须 contained in workspace root
workspace root 由 Backend/部署环境控制；不为本地恶意 TOCTOU threat 自研低层 filesystem primitive

Monaco Model 是唯一 unsaved text buffer
Dirty State 只保存 dirty/version metadata，不保存第二份未保存正文
同一 canonical URI 不同时存在多个 active Monaco Models
同一 Model persisted save 必须串行，避免 out-of-order write 回退 Backend 内容
save completion 只有 current model version == captured savedVersion 时才可清 dirty
save failure 或 save 期间发生新 edit 时 dirty 保持 true

Filesystem persisted operation success 后再 reconcile Monaco/Syntax derived state
Backend failure 不提前破坏 client identity state
clean open file rename 使用 old Model/Syntax dispose + new canonical URI recreate
禁止修改 existing Monaco Model URI
dirty open file rename/delete 被拒绝
directory rename/delete 有任意 open descendant 时被拒绝
close 不隐式写回 dirty overlay
rename/delete 后旧 Path/URI/Model/Syntax Session 不残留

Browser save → Remote FS → Workspace API → Backend FS → real file
Backend subsequent read 同一 WorkspacePath 得到完全相同内容
Browser reopen 从 Backend persisted content 读取，不从 Browser cache 读取
API success/error payload 不泄露 host filesystem path

W-08 才允许在 verifier/tests 已存在后注册 verify:m25
verify:m25 production build once / preview once / phase regressions once / cleanup once
不得通过 verify:m2 → verify:m25 嵌套导致重复 build/preview
W-08 可以使用最小 Browser integration probe，不要求提前开发完整 Workspace Explorer
```

红线：

- 存在第二份 persisted source content → `M2.5 FAIL`
- Browser 保存需要先写 Browser Store 再 sync Backend → `M2.5 FAIL`
- Dirty State / Browser cache 保存第二份 unsaved text 并与 Monaco 并列成为编辑 buffer → `M2.5 FAIL`
- Workspace Core 直接依赖 `fetch`、Node errno 或 host filesystem path → `M2.5 FAIL`
- Domain 直接依赖 host filesystem path → `M2.5 FAIL`
- Monaco Model 被当作 persisted Source of Truth → `M2.5 FAIL`
- Protocol 或响应 DTO 泄露 host filesystem path → `M2.5 FAIL`
- 客户端可以提供/覆盖 Backend workspace root → `M2.5 FAIL`
- BackendWorkspaceFileSystem 自己把 workspaceId 当授权凭证或建设 Auth/RBAC 职责 → `M2.5 FAIL`
- encoded traversal / symlink 可以逃逸已授权 workspace root → `M2.5 FAIL`
- 较旧 save response 可以清除较新 dirty state → `M2.5 FAIL`
- 并发 save 可以因 out-of-order write 把 Backend persisted content 回退 → `M2.5 FAIL`
- dirty file rename/delete 未经明确 save/discard/close 就执行 → `M2.5 FAIL`
- directory rename/delete 静默迁移仍打开的 descendant Models/Syntax Sessions → `M2.5 FAIL`
- 同一 IDE shell 同时保留两个 `file:///workspace/...` active namespace → `M2.5 FAIL`
- W-08 只跑 unit test、没有真实 Browser → API → Backend persisted filesystem integration proof → `M2.5 FAIL`

---

# M3 Review

重点：Gateway 不实现语义、客户端不能传任意 command、Workspace session 隔离、process lifecycle、auth/origin/allowlist、cleanup、成熟 SQL LS、Semantic Tokens 不冲突。

冻结边界：当前链路仍是 Browser → WebSocket → Gateway → Language Server；Semantic / LSP 上层不得直接写死 WebSocket。Transport 只做到当前 Web 所需程度，不实现 Desktop stdio 或 Neovim adapter。

额外检查：Language Server 必须能够通过 canonical `rootUri` 访问对应的 workspace filesystem view。冻结的是 URI 与实际可访问文件视图的一致性，不冻结 mount / jail / container filesystem mapping 等具体部署机制。

优先目标：

```text
Browser URI
  = LSP URI
  = Language Server 可访问的逻辑 filesystem URI
```

具体 filesystem namespace 机制在 M3 根据实际部署环境决定。如果环境无法提供一致 namespace，必须显式设计并测试 URI / path mapping；不要默认引入复杂 JSON-RPC URI rewrite。

红线：canonical LSP URI 无法解析到 Language Server 实际可访问的 workspace filesystem view → `M3 FAIL`。

---

# M4 Review

唯一核心问题：第二/第三语言接入是否主要靠 language definition / asset / mapping / composition registration。

允许修改集中式 language composition registration；如果必须修改通用 Tree-sitter runtime / Worker Protocol / Monaco Core 才能支持第二语言，则 `M4 FAIL`。

---

# M5 Review

重点：优先复用成熟 debug service；Advanced feature 独立；AI Context 不反向污染 Syntax Engine。

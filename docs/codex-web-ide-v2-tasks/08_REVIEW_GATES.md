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

---

# M2.5 Review

重点：WorkspacePath / canonical URI / host path 三层边界、WorkspaceFileSystem contract、Backend persisted filesystem、RemoteWorkspaceFileSystem、dirty overlay、save/rename/delete 生命周期、Backend read-after-save 一致性。

冻结边界：Backend Workspace Filesystem 是 persisted file content Source of Truth；Monaco Model 只是 open document / dirty overlay；Database 只保存 workspace metadata。只实现薄 `WorkspaceFileSystem` boundary 和当前 Web adapter，不建设双 Source of Truth；Backend real path 不得进入 Browser / Domain。

额外必须检查：

```text
one IDE shell = one active workspace
WorkspacePath root 用 "" 表示且只在允许 root 的目录操作中使用
非 root WorkspacePath 只用 /，禁止 absolute / trailing / // . .. backslash NUL
transport decode 后重新执行 WorkspacePath validation
API 使用 workspaceId + WorkspacePath，不接受客户端 host root
服务器先 authorize workspaceId，再解析 server-owned root
path containment 不只检查 ..，symlink 不能逃逸 workspace root
WorkspacePath ↔ canonical URI round-trip 一致
```

红线：

- 存在第二份 persisted source content → `M2.5 FAIL`
- Browser 保存需要先写 Browser Store 再 sync Backend → `M2.5 FAIL`
- Workspace Core 直接依赖 `fetch` → `M2.5 FAIL`
- Domain 直接依赖 host filesystem path → `M2.5 FAIL`
- Monaco Model 被当作 persisted Source of Truth → `M2.5 FAIL`
- LSP 直接读取浏览器不存在的虚拟文件 → `M2.5 FAIL`
- Protocol 或响应 DTO 泄露 host filesystem path → `M2.5 FAIL`
- 客户端可以提供/覆盖 Backend workspace root → `M2.5 FAIL`
- encoded traversal / symlink 可以逃逸已授权 workspace root → `M2.5 FAIL`
- 同一 IDE shell 同时保留两个 `file:///workspace/...` active namespace → `M2.5 FAIL`

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

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

重点：Query pinned、build-time compatibility、runtime load/compile/cache、Capture DTO 隔离 Tree-sitter、单一 Semantic Token Owner、Folding/Selection 独立 provider。

---

# M2.5 Review

重点：WorkspacePath / canonical URI / host path 三层边界、WorkspaceFileSystem contract、Backend persisted filesystem、RemoteWorkspaceFileSystem、dirty overlay、save/rename/delete 生命周期、Backend read-after-save 一致性。

冻结边界：Backend Workspace Filesystem 是 persisted file content Source of Truth；Monaco Model 只是 open document / dirty overlay；Database 只保存 workspace metadata。只实现薄 `WorkspaceFileSystem` boundary 和当前 Web adapter，不建设双 Source of Truth；Backend real path 不得进入 Browser / Domain。

红线：

- 存在第二份 persisted source content → `M2.5 FAIL`
- Browser 保存需要先写 Browser Store 再 sync Backend → `M2.5 FAIL`
- Workspace Core 直接依赖 `fetch` → `M2.5 FAIL`
- Domain 直接依赖 host filesystem path → `M2.5 FAIL`
- Monaco Model 被当作 persisted Source of Truth → `M2.5 FAIL`
- LSP 直接读取浏览器不存在的虚拟文件 → `M2.5 FAIL`
- Protocol 或响应 DTO 泄露 host filesystem path → `M2.5 FAIL`

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

唯一核心问题：第二/第三语言接入是否主要靠配置？如果必须修改核心 Engine：`M4 FAIL`。

---

# M5 Review

重点：优先复用成熟 debug service；Advanced feature 独立；AI Context 不反向污染 Syntax Engine。

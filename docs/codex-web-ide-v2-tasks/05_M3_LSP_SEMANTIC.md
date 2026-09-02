# 05 — M3 Semantic / LSP

进入条件：`M2.5 PASS`。

第一版 LSP 不启用 Semantic Tokens；Highlight 仍由 Tree-sitter 独占。

## Web-first Transport Boundary（冻结）

当前 Web 链路保持：

```text
Browser → WebSocket → Gateway → Language Server
```

Semantic / LSP 上层只能依赖 transport boundary 和 session contract，不得直接把 WebSocket 写死在语义业务层。Transport boundary 只实现当前 Web 所需程度。

不要实现 Desktop stdio，也不要实现 Neovim adapter。Desktop / Neovim 只作为未来架构边界检查；不得借 M3 提前建设 UniversalPlatform、UniversalEditor 或 UniversalTreeSitterEngine。

## Workspace Filesystem View（冻结）

Language Server 必须看到与 canonical `rootUri` 一致的 filesystem view。Web 当前推荐：

```text
Backend real workspace
        ↓ mount / jail
    /workspace
        ↓
file:///workspace/...
```

因此：

```text
Browser URI
  = LSP URI
  = Language Server 可访问的逻辑 filesystem view
```

Workspace persisted content 仍只来自 Backend Workspace Filesystem；未保存内容通过 LSP document overlay 传递。Semantic / LSP 上层只依赖 canonical URI 与 transport/session boundary，不直接依赖 host path，也不默认设计复杂 JSON-RPC URI rewrite。

---

# LSP-01 — Gateway Protocol / Session Contract

## 目标

冻结 Browser LSP Client 与 Gateway 的最小契约。

## 实现

定义：

```text
workspaceId
languageId
sessionId
canonical rootUri
WebSocket endpoint
```

客户端不能传任意 executable/args。

## 验证

协议 schema/test 完整。

## 不要做

- 不 spawn Language Server。
- 不加入 SQL dialect 特殊逻辑。

---

# LSP-02 — Gateway Skeleton + WebSocket JSON-RPC

## 依赖

`LSP-01 PASS`

## 目标

正式化 S0 的最小通信链路。

## 实现

Gateway 管理连接和 JSON-RPC transport；先连接 mock server，不启动真实 LS。

## 验证

connect/reconnect/dispose/multi-session。

## 可并行

可与 `LSP-03` 在不同服务文件中并行。

---

# LSP-03 — Workspace Session / Process Lifecycle

## 依赖

`LSP-01 PASS`, `M2.5 PASS`

## 目标

实现 Language Server 进程的启动、复用、关闭和 idle timeout。

## 实现

客户端只发 `languageId`；服务器内部 allowlist 映射 command。按 workspace/session 隔离 lifecycle。

## 验证

- 同 Workspace 合理复用。
- session close 后进程按策略关闭。
- crash 后状态可观测。
- 不接受任意 command。

## 不要做

- 不实现业务 semantic adapter。

---

# LSP-04 — Security Gate 基础

## 依赖

`LSP-02`, `LSP-03 PASS`

## 目标

在接真实 LS 前建立最小安全边界。

## 实现

至少：

```text
Authentication hook
WebSocket Origin validation
Workspace authorization
Language allowlist
Fixed server arguments
Idle timeout
Process cleanup
Workspace path jail
```

资源 quota/container 可按部署环境落地，但接口必须预留并有明确 TODO/配置。

## 验证

非法 language、非法 workspace、非法 origin/未授权请求被拒绝。

## 可分配子 Agent

Security Review Agent 只做攻击面检查和测试，不改主进程生命周期实现。

---

# LSP-05 — SQL Dialect / Language Server 决策 Spike

## 依赖

`LSP-04 PASS`

## 目标

根据项目真实 SQL 需求选择主 dialect 和成熟 Language Server。

## 实现

这是决策任务，不直接写业务功能。输出 ADR：

```text
dialect
language server
安装方式
启动命令
workspace/schema 能力
已知限制
```

## 不要做

- 不自己实现 SQL semantic。
- 不同时接多个 SQL LS。

## 可分配子 Agent

非常适合独立 Research/Spike Agent。

---

# LSP-06 — 接入 SQL Language Server

## 依赖

`LSP-05 PASS`

## 目标

Gateway 能针对一个 Workspace 启动选定 SQL LS，并完成 initialize/open/change/close。

## 实现

Workspace persisted files 来自 Backend Workspace Filesystem；未保存内容通过 didOpen/didChange overlay。

## 验证

SQL 文档打开、编辑、关闭时 LS session 状态正确。

---

# LSP-07 — Completion / Hover / Diagnostics

## 依赖

`LSP-06 PASS`

## 目标

先打通三个最核心 Semantic 能力。

## 实现

优先使用成熟 LSP Client/Monaco adapter，不自己重写协议转换。

## 验证

分别用最小 SQL case 验证：

```text
Completion
Hover
Diagnostics
```

## 不要做

- 不启用 LSP Semantic Tokens。
- 不做 Schema Browser UI。

---

# LSP-08 — Definition / References / Rename

## 依赖

`LSP-07 PASS`

## 目标

验证 navigation/refactor 能力。

## 实现

只接 LS 已提供能力；如果 SQL LS 不支持某项，记录能力缺失，不自行补语义引擎。

## 验证

Capability detection 正确；Unsupported 不 crash。

---

# LSP-09 — LSP Integration / Security Gate

## 验证

```text
Workspace isolation
connect/reconnect
process lifecycle
didOpen/didChange/didClose
Completion
Hover
Diagnostics
Definition/References（按 LS 能力）
Unauthorized reject
invalid language reject
process cleanup
```

## Stop Rule

Security Gate 失败：

```text
禁止生产部署 Gateway
```

# 08 — Review Gates

主 Agent 在每个阶段完成后执行一次独立 Review。

推荐使用一个 **Review Agent**，默认只读，不写代码。

---

# S0 Review

只检查：

```text
依赖是否精确锁定
production build 是否通过
Worker 是否能 production 运行
WASM 是否可加载
Monaco lifecycle 是否正确
minimal LSP 是否成立
ADR/runtime-lock 是否完整
```

不检查后续架构。

---

# M1 Review

重点：

```text
是否语言无关
Worker 是否可重建
session/version/generation 过滤是否正确
incremental parse 是否有 full resync fallback
Unicode/CRLF 是否通过
资源是否 dispose
多文档是否成立
性能 Gate 是否通过
```

红线：

- 出现 SQL 专用 Engine。
- Worker 成为 Source of Truth。
- 上层直接拿 `SyntaxNode`。

---

# M2 Review

重点：

```text
Query 是否 pinned
Query compatibility 是否主要在 build-time
runtime 是否只 load/compile/cache
Capture DTO 是否隔离 Tree-sitter
只有一个 Semantic Token Owner
Folding/Selection 是否独立 provider
```

---

# M2.5 Review

重点：

```text
Workspace 是否真正 Source of Truth
canonical URI 是否统一
host path 是否隔离
dirty overlay 是否清晰
save/rename/delete 生命周期是否一致
Backend snapshot 是否和 Browser 一致
```

红线：

- LSP 直接读取浏览器不存在的虚拟文件。
- protocol 泄露 host filesystem path。

---

# M3 Review

重点：

```text
Gateway 不实现语义
客户端不能传任意 command
Workspace session 隔离
process lifecycle
auth/origin/allowlist
cleanup
SQL LS 使用成熟实现
LSP Semantic Tokens 未与 Tree-sitter 冲突
```

---

# M4 Review

唯一核心问题：

> 第二/第三语言接入是否主要靠配置？

如果必须改核心 Engine：

```text
M4 FAIL
```

---

# M5 Review

重点：

- 是否优先复用成熟 debug service。
- Advanced feature 是否独立。
- AI Context 不反向污染 Syntax Engine。

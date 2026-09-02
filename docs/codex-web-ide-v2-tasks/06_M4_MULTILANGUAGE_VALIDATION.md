# 06 — M4 Multi-language Validation

进入条件：`M3 PASS`。

目标：验证 Framework 是否真的语言无关。

最重要的规则：

> 如果接入第二语言必须修改核心 Tree-sitter Engine / Worker / Monaco Core，M4 直接判定失败。

---

# M4-01 — TypeScript Syntax Assets

## 目标

通过 `LanguageDefinition` 接入 TypeScript Grammar/Query。

## 实现

只增加 TypeScript language config、pinned grammar/query assets 和必要 capture mapping。

## 验证

AST / incremental parse / highlight / folding / selection 可用。

## 不要做

- 不新增 `TypeScriptTreeSitterEngine`。
- 不修改通用 Worker Protocol。

---

# M4-02 — TypeScript LSP

## 依赖

`M4-01 PASS`

## 目标

通过现有 Workspace + Gateway 接入成熟 TypeScript Language Server。

## 实现

只新增 server allowlist/config 和语言注册。Workspace 必须能提供 `package.json/tsconfig.json/src/*`。

## 验证

```text
Completion
Hover
Diagnostics
Definition
References
```

跨文件 import 能工作。

---

# M4-03 — Python Syntax Assets

可与 `M4-01/M4-02` 在独立语言目录中并行。

## 目标

通过同一 Language Registry 接入 Python Tree-sitter 资产。

## 验证

AST / incremental parse / highlight / folding / selection。

## 不要做

- 不改核心 Engine。

---

# M4-04 — Python LSP

## 依赖

`M4-03 PASS`

## 目标

通过现有 LSP Gateway 接入成熟 Python LS。

## 验证

跨文件 import、Completion、Hover、Diagnostics、Definition。

---

# M4-05 — Formatter Provider

## 目标

建立通用 FormatterProvider，并至少验证 SQL/TypeScript/Python。

## 实现

复用成熟 Formatter；统一输出 `TextEdit[]`。

## 验证

三种语言能通过同一 Provider 接口调用。

## 可并行

可与 TypeScript/Python LSP 任务并行，避免修改同一 language config 文件。

---

# M4-06 — Framework Validation Gate

## 必须检查

新增 TS/Python 是否：

```text
无需修改核心 Tree-sitter Engine
无需新增语言专用 Worker
无需新增语言专用 Monaco Core
无需修改 Workspace URI Contract
无需修改 LSP Gateway Protocol
```

如果为了第二语言出现大量核心特殊分支：

```text
M4 = FAIL
```

先回头修 Framework，不进入 M5。

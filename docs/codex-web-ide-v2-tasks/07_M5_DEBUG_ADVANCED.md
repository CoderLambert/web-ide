# 07 — M5 Debug / Advanced

进入条件：`M4 PASS`。

此阶段不再默认自研完整 DAP Client。

---

# M5-01 — DAP Reuse Spike

## 目标

比较成熟 Monaco/VSCode debug service 与自研 DAP Client 的成本。

## 比较

```text
A. monaco-vscode debug services + existing Debug Adapter
B. custom DAP Client + Session + UI
```

## 输出

ADR：

```text
可复用能力
缺失能力
依赖复杂度
生产风险
推荐方案
```

## 决策规则

成熟方案满足主要需求：

```text
优先复用
```

只补缺失部分。

## 可分配子 Agent

独立 Spike/Review Agent。

---

# M5-02 — JavaScript Debug MVP

## 依赖

`M5-01 PASS`

## 目标

按 ADR 选择的方案打通一个最小 JS Debug Session。

## 验证

```text
Breakpoint
Continue
Step Over
Call Stack
Variables
Session close
```

## 不要做

- 不同时实现 Python。
- 不做复杂 Watch/Debug Console UX。

---

# M5-03 — Python Debug MVP

## 依赖

`M5-01 PASS`

可在 JS Debug 基础设施稳定后并行实现语言配置。

## 验证

同样的最小 Debug 能力。

---

# M5-04 — Structural Navigation

## 目标

利用现有 Tree-sitter AST 实现：

```text
current function/class
parent navigation
AST expand selection enhancements
breadcrumb source
```

保持与 LSP semantic navigation 分层。

---

# M5-05 — Structural Search / Replace Spike

## 目标

验证 Tree-sitter Query 是否适合项目所需 Structural Search。

先做 Spike，不直接做完整 UI。

---

# M5-06 — AI Context Extraction

## 目标

基于 Tree-sitter 提供结构化 Context API，例如：

```text
current function
current class
nearby syntax nodes
code chunk
```

不在本任务实现 AI 模型调用。

---

# M5-07 — Advanced Gate

逐项验收，不要求所有高级能力一次完成。

每个高级功能保持独立 feature/task，不重新耦合到 Editor Core。

# M1-10 ~ M1-11 — Full Resync / Monaco Binding

## M1-10 ReplaceDocument / Full Resync

依赖：`M1-09 PASS`

### 目标

为所有无法安全增量处理的情况提供统一正确性逃生通道。

### 允许修改

```text
src/syntax/tree-sitter/worker/document-manager.ts
相关 unit/integration tests
```

### 实现

`ReplaceDocument` 接收 authoritative full snapshot：

```text
documentUri
sessionId
documentVersion
text
```

流程：

```text
full parse new text
-> success
-> delete old tree
-> swap tree/text/version
-> state = ready
```

如果 full parse 失败，不破坏旧状态。

### 必须覆盖

```text
version mismatch
mirror mismatch
EditCodec failure
incremental parse failure
setValue/flush
EOL reset
```

### 禁止

不尝试复杂 rollback；不为异常强行继续 incremental。

---

## M1-11 MonacoSyntaxBinding

依赖：`M1-07 PASS`, `M1-10 PASS`

### 目标

首次建立真实 Monaco Model -> Syntax Foundation 链路。

### 允许修改

```text
src/editor/monaco/syntax-document-binding.ts
必要的 composition/probe 文件
相关 integration/E2E tests
```

### 边界

`src/syntax/**` 绝不能 import Monaco。

Binding 负责：

```text
bind model -> create sessionId -> OpenDocument(full snapshot)
content change -> ApplyChanges(baseVersion,nextVersion)
flush/EOL -> ReplaceDocument(full snapshot)
language change -> close old session + new session/full open
model dispose -> CloseDocument + dispose listeners
```

`documentUri` 第一版使用 `model.uri.toString()`，Syntax Core 将其视为 opaque identity。

使用真实 `event.versionId`；不要假设版本只加 1。

### 验证

- 真实 Monaco typing 驱动 Worker parse。
- undo/redo。
- setValue/flush。
- EOL change。
- language change 创建新 session。
- model dispose close session。
- 两个 model 同时工作。
- Syntax Core 无 Monaco import。

### 页面验收

`/ide` 只需增加最小开发者状态：

```text
documentVersion
parseTime
hasErrors
```

不要做产品 UI。

## Stop Rule

M1-10/11 分别验证、review、commit、push。Binding PASS 前禁止 Worker Recovery。

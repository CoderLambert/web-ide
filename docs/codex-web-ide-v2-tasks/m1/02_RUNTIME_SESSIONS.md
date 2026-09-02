# M1-03 ~ M1-04 — Runtime / Sessions

依赖：`M1-01 PASS`, `M1-02 PASS`

## M1-03 WorkerRuntime / LanguageRuntime

### 目标

把 S0 Tree-sitter spike 收敛成正式、语言无关 Runtime。

### 允许修改

```text
src/syntax/tree-sitter/worker/runtime.ts
src/syntax/tree-sitter/worker/language-runtime.ts
tests/unit/syntax/*runtime*
```

### 实现约束

- `Parser.init()` 每个 Worker 生命周期一次。
- 延续 S0 已验证方式：`fetch wasm -> Uint8Array -> Language.load(bytes)`。
- 每语言 `1 Language + 1 Parser`；文档共享 Parser。
- 成功 load 才缓存；失败不得永久缓存 rejected state。
- 不复制 grammar repository/revision/SHA 到 Browser Runtime；provenance 继续由现有 lock/ADR 管理。

### 验证

- SQL 通过 `LanguageDefinition` 加载。
- 重复 load 不重复初始化/下载。
- load failure 后可以 retry。
- production WASM path 仍可用。
- dispose 可执行。

### 禁止

Parser per document、Parser Pool、Query、版本升级。

---

## M1-04 DocumentSession / DocumentManager

### 目标

Worker 支持多个独立文档。

### 允许修改

```text
src/syntax/tree-sitter/worker/document-session.ts
src/syntax/tree-sitter/worker/document-manager.ts
tests/unit/syntax/*document*
```

### Session

```text
documentUri
sessionId
documentVersion
languageId
textMirror: string
tree
state: ready | desynced
```

DocumentManager 至少维护：

```text
sessionId -> session
documentUri -> sessionId
```

同 URI 同时只允许一个 active session；新 session 不得隐式覆盖旧 session。

### Open

```text
validate -> load language -> full parse -> create session
```

### Close

```text
lookup -> tree.delete() -> remove maps
```

Close 幂等；旧 `sessionId` 绝不能关闭新 session。

### 验证

- 同时打开两个 SQL 文档。
- duplicate active URI 被拒绝。
- close/reopen 使用新 sessionId。
- 20 次 open/close 后 session count = 0。
- Tree 正确释放。

### 禁止

不做 ApplyChanges、Recovery、Query、Monaco Binding。

## Stop Rule

每个 Task 独立验证、review、commit、push；M1-04 PASS 前禁止 Incremental Parse。

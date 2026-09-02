# 02 — M1 Syntax Foundation

目标：

```text
Monaco
  ↓
Tree-sitter Client
  ↓
Worker
  ↓
多 DocumentSession
  ↓
稳定 Incremental AST
```

进入条件：`S0 PASS`。

---

# M1-01 — LanguageDefinition / LanguageRegistry

## 目标

建立语言无关的最小注册模型。

## 实现

定义 `LanguageDefinition`、`SyntaxToolchainLock`、`QueryAsset` 和 `LanguageRegistry`。只注册 SQL 配置，不加载 Parser，不写任何 SQL 专用 Engine。

## 允许修改

```text
src/language/*
src/languages/sql/definition.ts
```

## 验证

- SQL 可通过配置注册/查询。
- 重复 ID 有明确错误。
- registry 不依赖 Monaco / Tree-sitter runtime。

## 不要做

- 不创建 Parser。
- 不加载 WASM。
- 不设计 LSP/DAP Provider。

## 并行

可与 `M1-02` 并行，文件边界必须分离。

---

# M1-02 — typed Worker Protocol

## 目标

冻结主线程与 Tree-sitter Worker 的消息契约。

## 实现

定义：

```ts
protocolVersion;
workerGeneration;
sessionId;
documentUri;
documentVersion;
requestId;
```

并定义：

```text
OpenDocument
ApplyChanges
ReplaceDocument
CloseDocument
ParseResult
InspectDocument
```

只定义类型和序列化边界，不实现 Runtime。

## 允许修改

```text
src/syntax/tree-sitter/protocol.ts
相关 protocol tests
```

## 验证

- request/response 类型完整。
- 每种消息有测试 fixture。
- protocol 不引用 Monaco 类型和 Tree-sitter `SyntaxNode`。

## 不要做

- 不实现 Worker。
- 不写 Editor adapter。

---

# M1-03 — LanguageRuntime

## 依赖

`M1-01 PASS`, `M1-02 PASS`

## 目标

把 S0 Spike 的 Runtime 收敛成正式、语言无关的 `LanguageRuntime`。

## 实现

根据 `LanguageDefinition.syntax.assets` 加载 pinned grammar；缓存 Language/Parser 必需对象。SQL 只是第一条配置输入。

## 允许修改

```text
src/syntax/tree-sitter/worker/runtime.ts
src/syntax/tree-sitter/worker/language-runtime.ts
```

## 验证

- SQL 通过配置加载。
- 重复 load 不重复下载/初始化。
- load 失败返回结构化错误。
- dispose 可执行。

## 不要做

- 不建立 DocumentSession。
- 不实现 Query。

---

# M1-04 — DocumentSession / DocumentManager

## 依赖

`M1-03 PASS`

## 目标

Worker 支持多个独立文档 Session。

## 实现

实现 `DocumentSession`：

```text
documentUri
sessionId
documentVersion
languageId
textMirror
tree
```

实现 open/close 和 session lookup。打开文档时 full parse；关闭时释放 tree/session。

## 验证

- 同时打开两个 SQL 文档。
- URI 相同的新 session 不复用旧 sessionId。
- close 后 session 数量恢复。
- tree 正确 dispose。

## 不要做

- 不做 change/edit。
- 不做 crash recovery。
- 不做 Query。

## 可分配子 Agent

### Session Test Agent

只写多文档、close/reopen、sessionId 回归测试。

---

# M1-05 — TreeSitterClient + 版本过滤

## 依赖

`M1-02 PASS`, `M1-04 PASS`

## 目标

主线程拥有类型安全 Client，并拒绝过期 Worker Result。

## 实现

实现请求 ID、sessionId、documentVersion、workerGeneration 过滤。只处理 open/close 和基础 ParseResult。

## 允许修改

```text
src/syntax/tree-sitter/client.ts
```

## 验证

构造：

```text
旧 generation
旧 session
旧 version
```

三类 response，必须全部被丢弃。

## 不要做

- 不接 Monaco change。
- 不实现 Worker restart。

---

# M1-06 — WorkerSupervisor

## 依赖

`M1-05 PASS`

## 目标

Worker crash 后语言能力可以从 Monaco Model/full snapshot 恢复。

## 实现

增加 Worker lifecycle supervisor：创建、terminate、generation++、ready、error、restart。恢复时重新加载语言并重新 `OpenDocument(full snapshot)` 当前打开文档。

## 验证

主动 terminate/crash Worker：

- Editor 内容不丢。
- generation 增加。
- 当前文档重新 parse。
- 旧 response 不被消费。

## 不要做

- 不实现增量 edit。
- 不实现自动无限重试；要有有限重试/失败状态。

---

# M1-07 — EditCodec 单元契约

## 依赖

`M1-02 PASS`

可与 `M1-04/M1-06` 在独立文件范围并行。

## 目标

先通过测试冻结 Monaco change → Worker edit transaction 的正确性。

## 实现

定义内部 edit transaction 和转换函数。测试覆盖：

```text
ASCII
中文
emoji
中文+emoji
CRLF
多行 insert/delete
replace
batch changes
multi cursor
```

上层不暴露 UTF-8/UTF-16 细节。

## 允许修改

```text
src/syntax/tree-sitter/edit-codec.ts
tests/...edit-codec*
```

## 验证

每次 edit 后：

```text
TextMirror === expectedText
```

坐标与 Tree-sitter parse node range 一致。

## 不要做

- 不修改 DocumentManager。
- 不接 Monaco Editor。

## 可分配子 Agent

最适合分给独立 Implementation + Test 子 Agent，但两者不能同时修改同一个测试文件。

---

# M1-08 — ApplyChanges + Incremental Parse

## 依赖

`M1-04 PASS`, `M1-07 PASS`

## 目标

实现真正的 Tree-sitter incremental parse。

## 实现

Worker 接收 `ApplyChanges`，更新 TextMirror，调用 `tree.edit()`，再执行 `parser.parse(updatedText, oldTree)`。返回轻量 ParseResult。

## 验证

- 修改 SQL 一个字符。
- tree 正确更新。
- 结果与 full reparse AST 等价。
- 连续快速 edits 不产生版本错乱。

## 不要做

- 不实现 Full Resync fallback 之外的高级恢复。
- 不做高亮。

---

# M1-09 — ReplaceDocument / Full Resync

## 依赖

`M1-08 PASS`

## 目标

为所有无法安全增量处理的情况提供正确性逃生通道。

## 实现

实现 `ReplaceDocument(fullText)`。当 flush、mirror mismatch、version mismatch、未知 edit failure 时，Client/Worker 能 full resync 并建立新 Tree。

## 验证

模拟：

```text
setValue/flush
版本跳变
故意破坏 mirror
```

最终 Worker text/tree 必须与 Monaco 当前全文一致。

## 不要做

- 不为异常情况继续强行增量修补。

---

# M1-10 — ParseResult / ChangedRanges

## 依赖

`M1-08 PASS`

## 目标

正常编辑链路只返回轻量解析状态。

## 实现

ParseResult 至少包含：

```text
documentUri
documentVersion
parseTime
hasErrors
changedRanges
```

不要序列化整棵 AST。

## 验证

增量修改后 changedRanges 合理；大文件编辑 response 大小不会随 AST 总节点数线性增长。

---

# M1-11 — On-demand AST Inspector

## 依赖

`M1-10 PASS`

## 目标

提供开发调试用 AST Inspector，但不进入日常 parse 热路径。

## 实现

实现：

```ts
inspectDocument({
  documentUri,
  maxDepth,
  maxNodes,
});
```

返回可序列化 DTO，并限制深度/节点数。

## 验证

- SQL 可查看 AST。
- `maxDepth/maxNodes` 生效。
- 普通编辑未打开 Inspector 时不传完整 AST。

## 不要做

- 不实现复杂 Tree UI。
- 不做 Query Inspector。

---

# M1-12 — M1 Integration / Performance Gate

## 依赖

全部 M1 task PASS

## 目标

不新增功能，只做整阶段验证和修复。

## 必须验证

```text
多文档
close/reopen
worker crash/recovery
Unicode edits
CRLF
batch changes
full resync
100KB SQL 连续输入
1MB SQL 打开/编辑
20 次 open/close
```

初始 Gate：

```text
incremental parse P95 < 50ms
主线程无 Tree-sitter >50ms long task
20 次 open/close 后 DocumentSession = 0
```

## Stop Rule

失败则继续修 M1，不进入 M2。

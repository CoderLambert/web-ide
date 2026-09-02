# M1-01 ~ M1-02 — Language / Protocol

## M1-01 LanguageDefinition / Registry + Unit Test Foundation

### 目标
建立最小语言注册模型，并启用纯逻辑单测。

### 允许修改
```text
src/language/**
src/languages/sql/definition.ts
tests/unit/language/**
vite.config.ts
package.json
```

### 实现
`LanguageDefinition` 第一版只包含：
```ts
interface LanguageDefinition {
  id: string;
  extensions: string[];
  syntax: { grammarWasmPath: string };
}
```

实现 `register/get/has`。SQL 只做配置输入。

单测优先使用 Vite+ 内置测试能力；不要为此重新引入独立 Vitest/Zod。

### 验证
- SQL register/get PASS。
- duplicate id 有明确错误。
- unknown id 行为明确。
- Registry 不依赖 Monaco/Tree-sitter runtime。
- `pnpm test:unit`、typecheck、check PASS。

### 禁止
QueryAsset、LSP、Formatter、DAP、Parser、自动插件发现。

---

## M1-02 Worker Protocol / Runtime Decoder

### 目标
冻结主线程/Worker 契约，并对 `postMessage: unknown` 做运行时校验。

### 允许修改
```text
src/syntax/tree-sitter/protocol.ts
tests/unit/syntax/*protocol*
```

### 必须定义
```text
protocolVersion  owner = shared constant
workerGeneration owner = WorkerSupervisor
requestId        owner = TreeSitterClient
sessionId        owner = document binding lifetime
documentVersion  owner = Monaco model
```

消息：
```text
OpenDocument
ApplyChanges
ReplaceDocument
CloseDocument
InspectDocument
WorkerReady
ParseResult
WorkerError
```

`ApplyChanges` 必须：
```text
baseVersion
nextVersion
changes[]
```

`TextChange` 使用 UTF-16 `rangeOffset/rangeLength/text`，不发送 Monaco Range。

项目位置 DTO：
```ts
interface TextPosition { line: number; character: number } // 0-based, UTF-16
interface TextRange { start: TextPosition; end: TextPosition }
```

错误至少：
```text
INVALID_MESSAGE
PROTOCOL_MISMATCH
UNKNOWN_LANGUAGE
DOCUMENT_ALREADY_OPEN
SESSION_NOT_FOUND
VERSION_MISMATCH
RESYNC_REQUIRED
LANGUAGE_LOAD_FAILED
PARSE_FAILED
INTERNAL_ERROR
```

### 验证
- 每种消息 fixture PASS。
- unknown/missing/invalid field 被 decoder 拒绝。
- protocol mismatch 被拒绝。
- Protocol 不引用 Monaco 或 `SyntaxNode/Tree`。

### 禁止
不实现 Worker、不接 Monaco、不实现 Parser。

## Stop Rule
M1-01/M1-02 分别通过后独立 commit/push；接口未冻结前禁止下游任务依赖。
# TanStack Start + Monaco + Tree-sitter + LSP 多语言 Web IDE 实施方案 V2

> **Stable-first · Production Baseline**
>
> 核心原则：**不追最新版本；优先选择已发布、兼容关系明确、社区使用充分、生产接入简单的版本组合。**
>
> 所有关键依赖精确锁版本，先通过 production build / preview / E2E，再进入下一阶段。

---

## 1. V2 结论

V2 不推翻原架构，而是把前两轮审查发现的风险正式修成工程约束。

### 1.1 核心职责

| 层             | 职责                                     | V2 决策                    |
| -------------- | ---------------------------------------- | -------------------------- |
| TanStack Start | 应用外壳、路由、普通 Server 能力         | 保留，但 IDE Core 与其解耦 |
| Monaco         | Editor / Model / Provider / UI           | 冻结                       |
| Tree-sitter    | Syntax / AST / Query / Incremental Parse | 冻结                       |
| LSP            | Semantic 能力                            | 冻结                       |
| DAP            | Debug Protocol / Adapter                 | 冻结                       |
| Workspace      | 项目文件 Domain 与 Filesystem boundary   | V2 升级为核心层            |

### 1.2 最终原则

```text
Monaco      = 编辑器平台 / open document
Workspace   = 项目文件 Domain
Tree-sitter = Syntax / Structure
LSP         = Semantic
DAP         = Debug

Worker      = Syntax Derived State
LSP State   = Semantic Derived State
```

**Backend Workspace Filesystem 是 persisted file content 的唯一 Source of Truth；Monaco、Tree-sitter、LSP 都不是项目文件的 Source of Truth。**

Workspace 的三层身份必须分开：

```text
WorkspacePath
  src/main.ts
        ↓ WorkspaceUriMapper
Canonical Runtime URI
  file:///workspace/src/main.ts
        ↓ BackendWorkspaceFileSystem 内部映射
Backend Host Path
  /var/lib/web-ide/workspaces/<id>/src/main.ts
```

Domain / Workspace 使用 `WorkspacePath`；Monaco、Tree-sitter、LSP 等 URI 边界使用 canonical URI；Backend host path 只允许存在于 Backend Filesystem / deployment adapter 内。

---

# 2. 稳定优先的依赖策略

V2 不使用“latest 优先”。

规则：

1. 优先官方已发布、兼容表明确的组合。
2. 禁止 `next` / `beta` / `canary` 进入核心链路。
3. 关键包使用精确版本，不使用 `^` / `~` 自动漂移。
4. `pnpm-lock.yaml` 必须提交。
5. CI / production build 使用 `--frozen-lockfile`。
6. 兼容相关依赖按版本组整体升级。
7. 每次核心依赖升级必须重新通过 S0 Compatibility Gate。
8. 如果当前版本没有安全问题或功能阻塞，不主动升级。

---

## 2.1 首选稳定基线

| 组件                         | 首选候选              | 原因                                             |
| ---------------------------- | --------------------- | ------------------------------------------------ |
| Monaco Editor                | `0.55.1`              | 与 monaco-languageclient 10.7.0 有已发布兼容组合 |
| monaco-languageclient        | `10.7.0`              | 已发布稳定版                                     |
| @codingame/monaco-vscode-api | `25.1.2`              | 与上述组合兼容                                   |
| web-tree-sitter              | `0.25.10`             | 作为稳定候选，避免直接追 0.26+                   |
| tree-sitter-cli              | `0.25.10`             | 与 Runtime 同版本，降低 WASM 兼容风险            |
| TanStack Start               | **S0 验证后精确锁定** | 当前仍是 RC，不直接追最新                        |
| Node.js                      | `22 LTS`              | 生产生态成熟                                     |

> 注意：以上是 **S0 的首选候选**，不是未经验证就永久锁死。
>
> 真正冻结的版本必须来自 S0 生产构建验证结果。

---

# 3. S0：Runtime Compatibility Gate

在正式实现 Language Framework 前，先执行一个最小技术验证。

S0 **只验证运行时兼容，不开发业务架构**。

```text
TanStack Start
      +
 /ide ssr:false
      +
    Monaco
      +
 Web Worker
      +
web-tree-sitter
      +
 SQL WASM
      +
LSP Client 最小连接
      +
production build
```

---

## 3.1 S0 必须验证

### TanStack Start

```text
pnpm dev
pnpm build
production preview
```

必须确认：

- `/ide` 使用 `ssr: false`
- Monaco 不参与 SSR
- Worker 可以在 production bundle 中创建
- WASM production 路径正确

### Monaco

必须确认：

- 创建 Editor
- 创建 Model
- 销毁 Editor
- 销毁 Model
- route remount
- Provider dispose

全部无异常。

### Tree-sitter

必须确认：

```text
tree-sitter.wasm
+
tree-sitter-sql.wasm
```

能够在 Worker 中：

```text
init
load language
parse SQL
dispose
```

### LSP Client

S0 只做最小链路：

```text
Monaco
  ↓
LSP Client
  ↓
WebSocket
  ↓
Mock / Minimal JSON-RPC Server
```

不要求完整 SQL LSP。

### Production

必须通过：

```text
pnpm build
production preview
E2E
```

**只通过 dev server 不算 S0 成功。**

---

## 3.2 S0 产物

S0 完成后生成：

```text
docs/adr/ADR-001-runtime-stack.md
runtime-lock.json
pnpm-lock.yaml
```

`ADR-001-runtime-stack.md` 至少记录：

```text
Node
pnpm
TanStack Start
Vite
Monaco
monaco-languageclient
monaco-vscode-api
web-tree-sitter
tree-sitter-cli
SQL grammar commit
构建命令
production 验证结果
```

---

# 4. 总体架构

```text
                         TanStack Start
                               │
                          /ide (ssr:false)
                               │
                ┌──────────────┴──────────────┐
                │                             │
              Monaco                    Workspace Domain
                │                             │
       ┌────────┴────────┐             WorkspacePath
       │                 │                    │
Tree-sitter Client    LSP Client       RemoteWorkspaceFileSystem
       │                 │                    │
     Worker          WebSocket          Workspace API
       │                 │                    │
 Tree-sitter        LSP Gateway       BackendWorkspaceFileSystem
       │                 │                    │
 Grammar + Queries   Language Server  Real Workspace Directory
```

### Source of Truth

```text
Backend Workspace Filesystem = persisted file content Source of Truth
Monaco    = 当前打开文件的编辑 Buffer / dirty overlay
Database  = workspace metadata

Worker    = Syntax Derived State
LSP       = Semantic Derived State
```

---

# 5. TanStack Start 边界

TanStack Start 只负责：

```text
Application Shell
Routing
普通 Server Function
普通 HTTP API
部署
```

IDE Core 不允许依赖：

```text
TanStack Route
Loader
Server Function
Router Context
```

核心模块：

```text
Editor
Workspace
Language Registry
Tree-sitter
LSP
DAP
Formatter
```

必须能够独立于 TanStack Start 存在。

---

# 6. 推荐项目结构

```text
src/
├── routes/
│   ├── __root.tsx
│   └── ide.tsx
│
├── features/
│   └── ide/
│
├── editor/
│   ├── monaco/
│   │   ├── create-editor.ts
│   │   ├── model-manager.ts
│   │   └── disposables.ts
│   └── adapters/
│       ├── semantic-tokens.ts
│       ├── folding.ts
│       └── selection-range.ts
│
├── workspace/
│   ├── filesystem.ts
│   ├── types.ts
│   ├── uri-mapper.ts
│   ├── dirty-overlay.ts
│   └── remote-workspace-filesystem.ts
│
├── server/workspace/
│   ├── workspace-api.ts
│   └── backend-workspace-filesystem.ts
│
├── language/
│   ├── registry.ts
│   ├── types.ts
│   ├── runtime-lock.ts
│   └── capabilities.ts
│
├── syntax/
│   └── tree-sitter/
│       ├── client.ts
│       ├── protocol.ts
│       ├── worker-supervisor.ts
│       ├── edit-codec.ts
│       ├── captures.ts
│       └── worker/
│           ├── worker.ts
│           ├── runtime.ts
│           ├── language-runtime.ts
│           ├── document-manager.ts
│           ├── query-manager.ts
│           └── inspector.ts
│
├── languages/
│   └── sql/
│       ├── definition.ts
│       └── captures.ts
│
├── highlight/
│   └── coordinator.ts
│
├── lsp/
├── dap/
└── formatter/

public/
└── languages/
    ├── tree-sitter.wasm
    └── sql/
        ├── tree-sitter-sql.wasm
        ├── manifest.json
        └── queries/
            ├── highlights.scm
            └── folds.scm

services/
├── lsp-gateway/
└── dap-gateway/

scripts/
├── sync-language-assets.ts
└── verify-language-assets.ts

docs/
└── adr/
    └── ADR-001-runtime-stack.md
```

以上是职责示意，不是现在锁死的物理目录。M2.5 应优先沿用仓库实际布局；目录命名不得重新引入 `workspace-store.ts` / `file-store.ts` 两套 persisted storage。

---

# 7. Workspace / FileSystem

V2 将 Workspace 从外围能力提升为核心层，但只冻结一个薄的 Web 所需 Filesystem boundary。Workspace 不再表示一个同时持有文件正文、metadata 和 URI 的 `Workspace Store`。

原因：

```text
TypeScript → tsconfig.json / package.json / imports
Python     → package imports / workspace files
Go         → go.mod / packages
Rust       → Cargo.toml / modules
```

LSP 不可能只依赖当前 Monaco 文件，但这不意味着 Browser 需要一份 persisted file store。Backend Workspace Filesystem 负责持久化内容，Monaco 负责 open document / dirty overlay，Database 只负责 workspace metadata。

## 7.1 统一 Workspace 模型

```text
WorkspacePath
  src/main.ts
       │
       ▼
WorkspaceFileSystem
       │
       ├── Web: RemoteWorkspaceFileSystem
       │             ↓ Workspace API
       └── BackendWorkspaceFileSystem
                     ↓
              Real Workspace Directory
              PERSISTED SOURCE OF TRUTH
```

Editor 侧：

```text
Backend File
    │ read
    ▼
Monaco Model
    │
    ├── edit → dirty overlay
    │
    └── save → WorkspaceFileSystem.writeFile()
```

冻结职责：

```text
Backend Workspace Filesystem = persisted file content Source of Truth
Monaco Model                = open document / dirty overlay
Database                    = workspace metadata
```

禁止为同一份 persisted content 建立第二份 Store 或 Browser cache 作为 Source of Truth。

## 7.2 Path / Canonical URI / Host Path

三层身份必须显式分离：

```text
WorkspacePath
  src/main.ts
       │ WorkspaceUriMapper.toUri()
       ▼
Canonical Runtime URI
  file:///workspace/src/main.ts
       │ BackendWorkspaceFileSystem 内部映射
       ▼
Backend Host Path
  /var/lib/web-ide/workspaces/<id>/src/main.ts
```

职责：

```text
Domain / Workspace     → WorkspacePath
Monaco / Tree-sitter   → Canonical URI
LSP                    → Canonical URI
Backend FS Adapter     → Host Path
```

基础 contract：

```ts
type WorkspacePath = string;

interface WorkspaceIdentity {
  id: string;
  rootUri: string;
}

interface WorkspaceFile {
  path: WorkspacePath;
  languageId?: string;
}

interface WorkspaceUriMapper {
  toUri(path: WorkspacePath): string;
  fromUri(uri: string): WorkspacePath;
}
```

Web 当前映射：

```text
src/main.ts → file:///workspace/src/main.ts
```

Backend host path 只能存在于 Backend Filesystem / deployment adapter 内，不得进入 Browser、Domain、Protocol 或响应 DTO。

## 7.3 WorkspaceFileSystem 与 Web Adapter

能力 contract：

```ts
interface WorkspaceEntry {
  path: WorkspacePath;
  kind: "file" | "directory";
  languageId?: string;
}

interface WorkspaceFileSystem {
  list(path: WorkspacePath): Promise<WorkspaceEntry[]>;
  readFile(path: WorkspacePath): Promise<string>;
  writeFile(path: WorkspacePath, content: string): Promise<void>;
  createFile(path: WorkspacePath): Promise<void>;
  createDirectory(path: WorkspacePath): Promise<void>;
  rename(from: WorkspacePath, to: WorkspacePath): Promise<void>;
  delete(path: WorkspacePath): Promise<void>;
}
```

当前 Web 链路：

```text
Browser
  → RemoteWorkspaceFileSystem
  → Workspace API
  → BackendWorkspaceFileSystem
  → Real Workspace Directory
```

Workspace Core 只依赖 `WorkspaceFileSystem` contract，不直接依赖 `fetch`。当前只实现 Web adapter；不建设 `UniversalPlatform`、Desktop stdio 或 Neovim adapter。

## 7.4 已保存内容与未保存内容

### 已保存

```text
Monaco save
    ↓
WorkspaceFileSystem.writeFile(path, content)
    ↓
Backend Workspace Filesystem
    ↓
Real Workspace Directory
```

### 未保存

```text
Monaco Model
    ↓
dirty overlay
    ↓
后续 LSP didOpen / didChange document overlay
```

每次按键不写 Backend file；Language Server 的 open document overlay 也不取代 Backend persisted content。

## 7.5 LSP 前必须完成

```text
open
save
create
rename
delete
close
```

每个操作都必须验证 Filesystem、Monaco Model、Dirty State、Syntax Session 的生命周期一致，且 rename/delete 后旧 Path、canonical URI、Model 和 Syntax Session 不残留。

后续再考虑：

```text
watch
search
git
filesystem index
```

这些不是 M2.5 的 persisted content boundary，也不能引入第二份 Source of Truth。

---

# 8. Language Registry

目标：

> 增加语言主要靠配置，不重新开发 Engine。

```ts
interface LanguageDefinition {
  id: string;
  extensions: string[];

  syntax?: {
    assets: SyntaxToolchainLock;
  };

  lsp?: {
    id: string;
  };

  formatter?: {
    id: string;
  };

  debug?: {
    id: string;
  };
}
```

禁止：

```text
SqlTreeSitterEngine
PythonTreeSitterEngine
RustTreeSitterEngine
```

---

# 9. Tree-sitter Toolchain Lock

V2 不只锁 Grammar 和 Query。

完整链路必须锁：

```text
web-tree-sitter
       ↓
tree-sitter-cli
       ↓
Grammar Commit
       ↓
Generated WASM
       ↓
Query Commit
       ↓
Local Patch
```

接口：

```ts
interface SyntaxToolchainLock {
  webTreeSitter: string;
  treeSitterCli: string;

  grammar: {
    repository: string;
    revision: string;
    wasmSha256: string;
  };

  queries: {
    highlights?: QueryAsset;
    folds?: QueryAsset;
    injections?: QueryAsset;
    locals?: QueryAsset;
  };
}

interface QueryAsset {
  repository: string;
  revision: string;
  path: string;
  patches?: string[];
}
```

---

# 10. Grammar WASM 构建原则

禁止：

```text
从网络下载未知 tree-sitter-sql.wasm
```

统一：

```text
Pinned Grammar Commit
        ↓
Pinned tree-sitter-cli
        ↓
Build WASM
        ↓
SHA256
        ↓
public/languages/sql/
```

构建产物必须可重复。

---

# 11. Query Asset Pipeline

Query Compatibility 主要放在构建期，而不是运行期。

```text
Pinned Upstream Query
        ↓
sync-language-assets.ts
        ↓
apply local patches
        ↓
validate against pinned grammar
        ↓
build artifact
        ↓
QueryManager
        ↓
load / compile / cache
```

Query 来源优先：

```text
Grammar 官方 Query
        ↓
nvim-treesitter
        ↓
Project Patch
```

每个 Query 独立记录：

```text
repository
revision
path
patches
```

不能假设：

```text
highlights
folds
injections
locals
```

都来自同一个仓库和 commit。

---

# 12. Tree-sitter Worker

Tree-sitter 从第一版就在 Worker 中运行。

```text
TreeSitterWorker
│
├── LanguageRuntime Map
│
└── DocumentSession Map
    │
    ├── file:///workspace/a.sql
    │
    └── file:///workspace/b.sql
```

DocumentSession：

```text
documentUri
sessionId
documentVersion
languageId
textMirror
tree
```

---

# 13. Worker Protocol

V2 元信息：

```ts
interface RequestMeta {
  protocolVersion: number;

  workerGeneration: number;
  sessionId: string;

  documentUri: string;
  documentVersion: number;

  requestId: number;
}
```

结果只有满足：

```ts
result.workerGeneration === currentGeneration &&
  result.sessionId === currentSessionId &&
  result.documentVersion === currentModelVersion;
```

才允许消费。

否则直接丢弃。

---

# 14. WorkerSupervisor

Worker 中所有状态都必须视为：

> **可丢弃 Derived State**

包括：

```text
Parser
Language
Query
Tree
Text Mirror
```

Worker crash 后：

```text
Worker crash
    ↓
terminate
    ↓
workerGeneration++
    ↓
create Worker
    ↓
Parser.init
    ↓
reload languages
    ↓
遍历 Monaco Models
    ↓
OpenDocument(full snapshot)
    ↓
rebuild syntax state
```

用户代码不会因为 Worker crash 丢失。

---

# 15. Document Protocol

不能只有 `ChangeDocument`。

V2 定义：

```ts
type DocumentMessage = OpenDocument | ApplyChanges | ReplaceDocument | CloseDocument;
```

---

## 15.1 普通编辑

```text
Monaco Change
      ↓
ApplyChanges
      ↓
EditCodec
      ↓
tree.edit()
      ↓
parser.parse(updatedText, oldTree)
```

---

## 15.2 Full Resync

以下情况直接：

```text
ReplaceDocument(fullText)
```

包括：

```text
model.setValue()
isFlush
EOL 大规模改变
version mismatch
Worker mirror mismatch
未知 edit 异常
```

原则：

> **Incremental Parse 是优化，不是正确性的前提。**

无法确认增量状态时立即 Full Resync。

---

# 16. EditCodec

Monaco 和 Tree-sitter 的位置语义不能散落在业务代码。

统一：

```text
Monaco Change
      ↓
Edit Transaction
      ↓
EditCodec
      ↓
Tree-sitter Edit
```

EditCodec 不向上层暴露：

```text
UTF-8
UTF-16
byte
code unit
```

这些是内部实现细节。

---

## 16.1 Conformance Tests

必须覆盖：

```text
ASCII
中文
emoji
中文 + emoji
CRLF
多行 insert
多行 delete
replace
batch changes
multi cursor
```

验证：

```text
Monaco Range
     ↕
Text Mirror
     ↕
Tree-sitter Node Range
```

始终一致。

---

# 17. AST Inspector

AST Inspector 是开发/调试功能。

正常 parse 只返回：

```ts
interface ParseResult {
  documentUri: string;
  documentVersion: number;

  parseTime: number;
  hasErrors: boolean;
  changedRanges: EditorRange[];
}
```

Inspector 按需：

```ts
inspectDocument({
  documentUri,
  maxDepth: 8,
  maxNodes: 2000,
});
```

禁止：

```text
每次按键
→ serialize 整棵 AST
→ postMessage
→ React render
```

---

# 18. Highlight 策略

第一阶段只允许一个 Semantic Token Owner。

```text
Monaco baseline tokenizer
        +
Tree-sitter Query
        ↓
SyntaxCapture[]
        ↓
HighlightCoordinator
        ↓
Monaco DocumentSemanticTokensProvider
```

---

## 18.1 LSP 第一阶段不接 Semantic Tokens

LSP 先提供：

```text
Completion
Hover
Definition
References
Rename
Diagnostics
Inlay Hint
Workspace Symbols
```

但：

```text
LSP Semantic Tokens = disabled
```

Tree-sitter 继续负责 Highlight。

等真实使用证明需要语义颜色时，再考虑：

```text
HybridSemanticTokenProvider
```

MVP 不做复杂 Token Merge。

---

# 19. SQL MVP 边界

SQL 第一阶段只是验证 Language Framework。

支持：

```text
generic / permissive SQL
AST
incremental parse
highlight
folding
selection
```

不承诺：

```text
PostgreSQL 完整语法
MySQL 完整语法
SQLite 完整语法
T-SQL 完整语法
```

不自己实现：

```text
Scope Resolver
Symbol Table
Schema Resolver
Type Inference
Completion
Hover
Definition
```

进入 SQL LSP 前必须先决定主 dialect。

---

# 20. LSP 架构

```text
Browser
│
├── Monaco
├── Workspace
└── LSP Client
      │
      │ WebSocket
      ▼
LSP Gateway
      │
      ├── Workspace Session
      ├── JSON-RPC Transport
      ├── Process Lifecycle
      ├── Authentication
      ├── Quota
      └── Language Server
```

Gateway 不负责语义实现。

---

# 21. LSP Gateway 安全边界

客户端禁止传任意：

```json
{
  "command": "..."
}
```

客户端只能请求：

```json
{
  "language": "python"
}
```

服务器内部映射：

```text
python      → pyright
typescript  → typescript-language-server
go          → gopls
rust        → rust-analyzer
```

生产必须考虑：

```text
Authentication
WebSocket Origin Validation
Workspace Authorization
Language Server Allowlist
Fixed Server Arguments
CPU Limit
Memory Limit
Process Limit
Idle Timeout
Workspace Jail
Network Policy
Process Cleanup
```

生产环境的 Workspace / Language Server 应运行在：

```text
sandbox / container
```

而不是允许任意 host process。

---

# 22. Formatter / Linter

继续复用成熟工具。

```text
JavaScript / TypeScript
├── Prettier
└── Biome

Python
├── Ruff
└── Black

Go
└── gofmt

Rust
└── rustfmt
```

统一：

```ts
interface FormatterProvider {
  format(code: string, languageId: string): Promise<TextEdit[]>;
}
```

---

# 23. DAP 策略

V2 不再默认自己开发完整 DAP Client。

先执行：

```text
DAP Reuse Spike
```

比较：

```text
A.
monaco-vscode debug services
+
existing Debug Adapter

vs

B.
自研 DAP Client
+
Session
+
Debug UI
```

规则：

```text
成熟生态方案满足主要需求
→ 复用

只缺少少量能力
→ 只补缺失部分
```

---

# 24. 生命周期

以下对象必须显式释放：

```text
Monaco Editor
Monaco Model
Provider
Worker
DocumentSession
Tree
Parser
Language
Query
LSP Session
DAP Session
```

禁止依赖 GC 作为生命周期管理方案。

关闭 Tab / 切换语言 / 路由卸载时必须正确清理。

---

# 25. 性能 Gate

M1 初始门槛：

| 场景                  | 初始目标                                   |
| --------------------- | ------------------------------------------ |
| 普通 incremental edit | Worker Parse P95 `< 50ms`                  |
| Main Thread           | 不出现 Tree-sitter `>50ms` long task       |
| 100KB SQL             | 连续输入无明显卡顿                         |
| 1MB SQL               | 可正常打开和编辑                           |
| 20 次 open/close      | DocumentSession 回到 0，无明显持续内存增长 |

这些是 provisional gate。

第一次真实 benchmark 后允许调整，但必须记录原因。

---

# 26. 测试策略

## Unit

```text
Language Registry
Toolchain Lock
URI Mapper
EditCodec
Version Filtering
Capture Normalizer
```

## Worker Integration

```text
runtime init
grammar load
open
change
replace
close
incremental parse
worker crash recovery
```

## Asset CI

```text
Grammar build
WASM SHA256
Query compile
Capture regression
```

## Monaco Integration

```text
Model lifecycle
Provider lifecycle
Semantic Tokens
Folding
Selection
```

## Workspace Integration

```text
open
save
create
rename
delete
dirty overlay
WorkspacePath normalization
canonical URI mapping
Browser save → Workspace API → Backend Filesystem read-after-save
host path isolation
```

## LSP Integration

```text
didOpen
didChange
Completion
Hover
Definition
References
Diagnostics
Reconnect
```

## Production E2E

必须真正跑：

```text
pnpm build
pnpm preview
browser
/ide
edit
worker
LSP
```

---

# 27. 实施阶段 V2

```text
S0 Runtime Compatibility
        ↓
M1 Syntax Foundation
        ↓
M2 Syntax UX
        ↓
M2.5 Workspace Foundation
        ↓
M3 Semantic / LSP
        ↓
M4 Multi-language Validation
        ↓
M5 Debug / Advanced
```

---

# 28. S0 — Runtime Compatibility

任务：

```text
S0.1 TanStack Start + /ide ssr:false
S0.2 Monaco stable stack
S0.3 Web Worker
S0.4 web-tree-sitter stable candidate
S0.5 pinned SQL grammar → self-built WASM
S0.6 production build / preview
S0.7 minimal LSP connection
S0.8 dependency lock
```

完成产物：

```text
ADR-001-runtime-stack.md
runtime-lock.json
pnpm-lock.yaml
```

---

# 29. M1 — Syntax Foundation

```text
M1.1 LanguageDefinition
M1.2 LanguageRegistry
M1.3 SyntaxToolchainLock
M1.4 typed Worker Protocol
M1.5 WorkerSupervisor
M1.6 DocumentSession
M1.7 Text Mirror
M1.8 EditCodec
M1.9 Incremental Parse
M1.10 Full Resync
M1.11 ParseResult
M1.12 AST Inspector
```

M1 目标：

```text
Monaco
  ↓
Worker
  ↓
Tree-sitter
  ↓
多文档
  ↓
稳定 Incremental AST
```

---

# 30. M2 — Syntax UX

```text
M2.1 Query Asset Pipeline
M2.2 Query Validation
M2.3 Capture Normalizer
M2.4 HighlightCoordinator
M2.5 Semantic Highlight
M2.6 Folding
M2.7 Selection Range
```

完成：

```text
SQL Syntax MVP
```

---

# 31. M2.5 — Workspace Foundation

没有这一阶段，禁止进入 LSP。

```text
W-01 WorkspacePath / Canonical URI / WorkspaceUriMapper
W-02 WorkspaceFileSystem Contract
W-03 BackendWorkspaceFileSystem
W-04 RemoteWorkspaceFileSystem / Workspace API
W-05 Monaco Binding / Dirty Overlay
W-06 Workspace Operations Lifecycle
W-07 Backend Visibility Contract
W-08 Workspace Integration Gate
```

统一模型：

```text
WorkspacePath
      ↓
RemoteWorkspaceFileSystem → Workspace API → BackendWorkspaceFileSystem
                                                       ↓
                                             Real Workspace Directory
```

Backend Workspace Filesystem 是 persisted file content 的唯一 Source of Truth；Monaco Model 是 open document / dirty overlay；Database 只保存 workspace metadata。

---

# 32. M3 — Semantic / LSP

```text
M3.1 LSP Gateway
M3.2 Workspace Session
M3.3 Process Lifecycle
M3.4 WebSocket / JSON-RPC
M3.5 Authentication / Security
M3.6 SQL Dialect 决策
M3.7 SQL Language Server
M3.8 Completion
M3.9 Hover
M3.10 Diagnostics
M3.11 Definition
M3.12 References
```

---

# 33. M4 — Multi-language Validation

按顺序：

```text
SQL
 ↓
TypeScript
 ↓
Python
```

验证：

> 新增语言是否真的主要靠配置完成。

成功标准：

```text
新增 TypeScript / Python
无需修改核心 Tree-sitter Engine
无需新增语言专用 Worker
无需新增语言专用 Monaco Core
```

如果做不到：

```text
M4 = FAIL
```

必须回头修 Framework。

---

# 34. M5 — Debug / Advanced

先做：

```text
DAP Reuse Spike
```

之后再：

```text
JS Debug
Python Debug
Breakpoint
Continue
Step
Variables
Call Stack
Debug Console
```

再进入：

```text
AST Navigation
Structural Search
Structural Replace
Current Function / Class
Breadcrumb
Language Injection
AI Context Extraction
Code Chunk Extraction
Semantic Diff
```

---

# 35. Stop Rules

这是 V2 的硬性约束。

```text
S0 不通过
→ 禁止进入 M1

M1 不通过
→ 禁止进入 highlights / Query UX

M2 不通过
→ 禁止进入 Workspace/LSP

M2.5 不通过
→ 禁止启动真实 Language Server

M3 Security Gate 不通过
→ 禁止生产部署 Gateway

第二语言需要修改核心 Engine
→ M4 判定失败
```

---

# 36. 依赖升级策略

## Group A — Monaco

```text
monaco-editor
monaco-languageclient
@codingame/monaco-vscode-api
vscode-ws-jsonrpc
```

必须作为一个 compatibility group。

---

## Group B — Tree-sitter

```text
web-tree-sitter
tree-sitter-cli
grammar commits
query commits
```

一起验证。

---

## Group C — TanStack

```text
@tanstack/react-start
@tanstack/react-router
vite
相关 Start 构建依赖
```

一起验证。

---

## 升级规则

1. 一个 Compatibility Group 一次升级。
2. 升级单独 PR。
3. 不与业务功能 PR 混合。
4. 必须重新运行相关 S0 / Regression。
5. 不自动 merge 依赖机器人 PR。
6. 没有必要就不升级。

---

# 37. 第一批 Codex 任务

**第一轮只做 S0。**

不要让 Codex 一次实现整个 IDE。

任务：

```text
S0.1
创建 TanStack Start + React + TypeScript 项目。
建立 /ide route，并设置 ssr:false。

S0.2
接入稳定 Monaco 版本组合。
验证 editor/model create/dispose/remount。

S0.3
接入 Web Worker。
接入 web-tree-sitter 稳定候选版本。

S0.4
固定 SQL grammar commit。
使用固定 tree-sitter-cli 自行构建 tree-sitter-sql.wasm。

S0.5
Worker 中加载 tree-sitter.wasm + SQL WASM。
执行最小 SQL parse。

S0.6
建立最小 LSP Client WebSocket JSON-RPC 验证。

S0.7
执行：
pnpm dev
pnpm build
pnpm preview
E2E

S0.8
生成：
docs/adr/ADR-001-runtime-stack.md
runtime-lock.json
```

---

# 38. 第一轮 Review 只检查什么

只检查：

```text
依赖版本是否稳定
版本是否完全锁定
production build 是否通过
Worker 是否可用
WASM 是否可加载
Monaco 生命周期是否正确
LSP Client 基础链路是否成立
```

**暂时不检查：**

```text
Tree-sitter Highlight
Folding
SQL Completion
完整 LSP
DAP
AI
高级 IDE UI
```

---

# 39. Codex 开发约束

Codex 后续开发必须遵守：

1. 不重新实现成熟 Grammar。
2. 不重新实现 Language Server。
3. 不重新实现 Debug Adapter。
4. 不重新实现成熟 Formatter。
5. 不让业务层直接依赖 `SyntaxNode` / `QueryCapture`。
6. 不建立 SQL 专用 Tree-sitter Engine。
7. 不提前抽象第二语言尚未验证的复杂 Provider。
8. 不把 LSP/DAP 长期进程放进一次性 TanStack Server Function。
9. 不随意升级核心依赖。
10. 不用未经 pin 的 WASM / Query / Grammar。
11. 增量解析异常时优先 Full Resync。
12. Worker 状态必须可重建。
13. WorkspacePath 是 Domain 的稳定文件身份；Monaco / Syntax / LSP 使用由 WorkspaceUriMapper 生成的 canonical URI；Backend host path 只存在于 Backend Filesystem adapter。
14. 每个 Milestone 完成后必须 Review，再进入下一阶段。

---

# 40. 最终冻结结论

## 可以冻结

```text
TanStack Start = Application Shell

Monaco = Editor Platform / open document / dirty overlay

Workspace = Project/File Domain

Backend Workspace Filesystem = persisted file content Source of Truth

Database = workspace metadata

WorkspacePath = Domain file identity

Canonical URI = Editor / Syntax / LSP file identity

Backend Host Path = Backend Filesystem adapter internal detail

Tree-sitter = Syntax / Structure

LSP = Semantic

DAP = Debug

Worker = Tree-sitter Runtime

Language Registry = 多语言扩展入口

LSP / DAP = 独立 Gateway

SQL = 第一验证语言

不运行 Neovim

不自己写 Grammar
不自己写 Language Server
不自己写 Debug Adapter
```

## 必须经过 S0 后冻结

```text
TanStack Start 精确版本

Monaco Compatibility Group 精确版本

web-tree-sitter 精确版本

tree-sitter-cli 精确版本

SQL grammar commit

WASM SHA256

Query commits
```

## 必须后续阶段再决定

```text
SQL 主 dialect
SQL Language Server
DAP UI 复用方案
Hybrid Semantic Tokens
```

---

# 41. 当前下一步

现在不要开始 M1。

直接执行：

```text
S0 Runtime Compatibility Gate
```

通过之后：

```text
freeze runtime
      ↓
review
      ↓
进入 M1 Syntax Foundation
```

这份 V2 的核心不是“架构越复杂越好”，而是：

> **成熟生态优先、版本稳定优先、正确性优先、生产构建优先；只有经过实际验证的抽象和依赖才允许进入实施基线。**

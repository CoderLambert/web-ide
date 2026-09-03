# 04 — M2.5 Workspace Foundation

进入条件：`M2 PASS`。

这是 LSP 的硬前置条件。

## Source of Truth 与 Web-first 边界（冻结）

```text
Backend Workspace Filesystem = persisted file content Source of Truth
Monaco Model                 = open document / unsaved text buffer
Dirty State                  = dirty/version metadata
Database                     = workspace metadata
```

M2.5 只保留薄的 `WorkspaceFileSystem` boundary，并且当前只实现 Web 所需的 adapter。Backend host 的 real path 只能存在于 Backend filesystem / deployment adapter 内，不能泄露到 Browser / Domain / Protocol。

禁止为同一份 persisted content 建立双 Source of Truth；Monaco 是唯一未保存文本 buffer，Dirty State 只保存状态/版本 metadata，不再复制一份未保存文本。Desktop / Neovim 仅作为未来架构边界检查，不在 M2.5 提前实现跨平台 filesystem/runtime adapter。

### 当前 Workspace Scope

M2.5 / M3 第一版只支持：

```text
one IDE shell = one active workspace
```

`file:///workspace/...` 只在当前 active workspace 内作为 canonical URI namespace。不要为了未来 multi-root / simultaneous multi-workspace 预先改 URI 方案。

如果未来实现 workspace switch，必须先处理 dirty state，再 dispose 当前 Workspace 的 Monaco Models / Syntax Sessions / derived state，之后才能激活新 Workspace；第一版不要求实现 multi-root。

## Task Graph（冻结）

```text
W-01 WorkspacePath / URI
        ↓
W-02 WorkspaceFileSystem Contract
        ↓
W-03 BackendWorkspaceFileSystem
        ↓
W-04 Workspace API / RemoteWorkspaceFileSystem
        ↓
W-05 Monaco / Dirty Overlay
        ↓
W-06 Operations Lifecycle
        ↓
W-07 Backend Visibility
        ↓
W-08 Integration Gate
        ↓
      REVIEW
```

W-03 与 W-04 不并行。W-04 的真实验收依赖 W-03 已冻结的 persisted filesystem、host-path isolation、symlink policy 与 server-side workspace resolution。

---

# W-01 — Workspace Identity / Path / URI

## 目标

冻结 Workspace 业务身份、canonical URI 和映射边界。`WorkspacePath` 是 Domain 的稳定文件身份；canonical URI 只在 Editor、Syntax、LSP 等 URI 边界使用。

## 实现

定义：

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
src/main.ts
    → file:///workspace/src/main.ts
```

`rootUri` 是 canonical URI。Backend host path 不进入上述类型。

### WorkspacePath Contract（冻结）

第一版统一规则：

```text
""              = workspace root，仅用于允许 root 的目录操作
src/main.ts      = 合法
src/lib/a.ts     = 合法
```

非 root `WorkspacePath` 必须：

- 相对 workspace root。
- 只使用 `/` 作为 separator。
- 不以 `/` 开头或结尾。
- 不包含空 segment（`//`）。
- 不包含 `.` 或 `..` segment。
- 不包含 `\` 或 NUL。
- transport decode 后再做 WorkspacePath validation；不能依靠编码形式绕过校验。

不要把非法 path “自动修正”为合法 path；Browser 与 Backend 使用同一 contract / fixtures 验证语义一致。

## 验证

- `WorkspacePath ↔ canonical URI` round-trip 一致。
- root `""` 只在允许 root 的操作中接受。
- `/a`、`a/`、`a//b`、`./a`、`a/../b`、反斜杠、NUL 和 decode 后 traversal 被拒绝。
- 非 canonical URI 被拒绝。

## 不要做

- 不实现文件内容存储。
- 不接 LSP。
- 不设计 multi-root URI namespace。

---

# W-02 — WorkspaceFileSystem Contract

## 依赖

`W-01 PASS`

## 目标

建立薄的 workspace-bound 文件系统能力边界，冻结 CRUD、root 与错误语义；不在接口内存储文件正文，也不把 metadata Store 当作 persisted content Store。

## 实现

冻结最小 Web 所需接口：

```ts
interface WorkspaceEntry {
  path: WorkspacePath;
  kind: "file" | "directory";
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

一个 `WorkspaceFileSystem` instance 绑定一个 active workspace。`workspaceId` 不进入每个 filesystem method；由 Remote/Server adapter 的创建边界绑定 workspace identity。

当前 contract 是 IDE 所需的 UTF-8 text filesystem capability：`readFile` / `writeFile` 使用 `string`。Binary/streaming file API 不属于 M2.5。

### Operation Semantics（冻结）

```text
list("")
  allowed
  返回 workspace root 的直接 children

list(non-root)
  directory only
  返回直接 children，不递归
  WorkspaceEntry.path 始终是完整 WorkspacePath

readFile
  existing file only

writeFile
  existing file only
  不隐式 create

createFile
  创建 empty UTF-8 text file
  parent directory 必须存在
  target 必须不存在

createDirectory
  parent directory 必须存在
  target 必须不存在
  第一版不 recursive mkdir

rename
  source 必须存在
  destination 必须不存在
  destination parent 必须存在
  不 overwrite

delete
  file 或 empty directory only
  第一版不 recursive delete
```

Root `""` 只允许 `list("")`。`readFile` / `writeFile` / `createFile` / `createDirectory` / `rename` / `delete` 都拒绝 root。

### Error Contract（冻结语义，不冻结实现类）

Backend 与 Remote adapter 必须归一化到稳定的 project-level error code；Workspace Core 不依赖 Node errno、HTTP status 或 `fetch` error。

```text
INVALID_PATH
NOT_FOUND
ALREADY_EXISTS
NOT_FILE
NOT_DIRECTORY
DIRECTORY_NOT_EMPTY
FORBIDDEN
UNSUPPORTED
IO_ERROR
```

接口只定义能力，不保存文件正文。`languageId` 不属于 filesystem entry；语言识别由 Workspace/Language/Editor composition 层处理。Workspace metadata 由独立 metadata boundary 管理；M2.5 不建设 Git、search 或 filesystem index。

## 验证

- WorkspacePath validation 与 W-01 shared fixtures 一致；禁止另建 normalization 规则。
- root、CRUD、directory/non-directory、exists/not-found 行为一致。
- Backend/Remote adapter 可映射到同一稳定 error semantics。
- `WorkspaceEntry` 不承担 language detection。

## 允许修改

```text
src/workspace/**
tests/unit/workspace/**
tests/fixtures/workspace-*
```

## 禁止修改

```text
src/editor/**
src/syntax/**
src/server/**
vite.config.ts
dependency versions
```

## 不要做

- 不实现 persisted backend。
- 不实现 Remote/API。
- 不增加 binary/streaming API。
- 不建设通用 repository/storage framework。

---

# W-03 — BackendWorkspaceFileSystem

## 依赖

`W-01 PASS`, `W-02 PASS`

## 目标

实现绑定 server-owned workspace root 的 `BackendWorkspaceFileSystem`，把 `WorkspacePath` 安全映射到 host filesystem，并实际读写 persisted workspace directory。

## 实现

它是 persisted file content 的唯一 Source of Truth。host path 只存在 adapter / deployment 层内；Domain、Browser、Protocol 和响应 DTO 不得看到 host path。

Authorization 与 filesystem adapter 分层：

```text
Workspace API / Server Service
  → authorize workspaceId
  → resolve server-owned workspace root
  → create/use BackendWorkspaceFileSystem(boundRoot)
  → validate WorkspacePath
  → safe filesystem operation
```

`workspaceId` 不是授权凭证；`BackendWorkspaceFileSystem` 不负责理解用户身份、session 或 RBAC，只消费已由 server boundary 解析出的可信 root。客户端不得提供、覆盖或推导 Backend host root。

如果当前没有完整 Workspace Auth / Metadata 系统，W-03 只允许增加最小 server-owned authorization/root resolver boundary；禁止为了本任务建设 Auth framework、RBAC、permission platform、database abstraction 或 workspace metadata platform。

### Symlink Policy（冻结）

第一版不支持 symlink：

- path 中任何已存在的中间 segment 是 symlink → reject。
- 显式访问 target 是 symlink → reject。
- create/rename destination 的 parent chain 不得经过 symlink。
- delete 不跟随 symlink。
- `list` 不把 symlink entry 暴露成 `WorkspaceEntry`；显式访问该 path 仍拒绝。

Path security 不能只检查字符串 `..`。对 existing target 或 create/rename parent 做实际 resolution 后，必须确认仍 contained in server-owned workspace root。

当前安全假设：workspace root 由 Backend/部署环境控制，不允许不可信本地进程与 IDE 同时恶意替换 filesystem entry。若未来 threat model 包含这种并发本地攻击，应依赖 jail/container/OS isolation，而不是在 M2.5 自研新的低层 filesystem primitive。

### Security Acceptance Evidence（冻结）

W-03 的 symlink / containment PASS 必须基于真实临时 filesystem，而不是只测试字符串 helper：

```text
real temporary workspace root
+ real files/directories
+ real symlink entries created through Node filesystem
+ real BackendWorkspaceFileSystem operations
```

至少分别证明：

- existing target 的 real resolution 不能逃逸 root。
- create/rename destination parent 的 real resolution 不能逃逸 root。
- intermediate symlink / target symlink 均被拒绝。
- symlink 指向 workspace 外部时无法 read/write/create/rename/delete 逃逸。

mock `lstat` / `realpath` / path helper 的 unit test 可以作为补充，但**不能作为 W-03 symlink/containment 的唯一验收证据**。

## 验证

- W-01 WorkspacePath fixtures 在 Backend 重复执行同一语义验证。
- absolute / traversal / encoded traversal 不能逃逸 Workspace。
- symlink intermediate / target 被拒绝；list 不暴露 unsupported symlink entry。
- 使用真实 temporary filesystem / real symlink 完成 containment security tests。
- rename/delete/create 与 W-02 operation semantics 一致。
- workspace root containment 正确。
- host path 不进入 Domain/Protocol/响应 DTO。
- 未授权 workspace 在创建 Backend adapter 前被 Server boundary 拒绝。

## 允许修改

```text
src/server/workspace/**
tests/unit/server/workspace/**
tests/fixtures/workspace-*
```

## 禁止修改

```text
src/editor/**
src/syntax/**
src/workspace public contract（除当前 contract 的必要 bug fix）
dependency versions
```

## 不要做

- 不实现 Remote adapter。
- 不启动 Language Server。
- 不建设通用 Auth/DB framework。
- 不支持 symlink traversal。

---

# W-04 — Workspace API / RemoteWorkspaceFileSystem

## 依赖

`W-01 PASS`, `W-02 PASS`, `W-03 PASS`

## 目标

建立当前 Web 所需的薄 Remote adapter：

```text
Browser
  → RemoteWorkspaceFileSystem(bound workspaceId)
  → Workspace API
  → authorize/resolve workspace
  → BackendWorkspaceFileSystem(bound server-owned root)
```

## 实现

浏览器业务代码通过 workspace-bound `RemoteWorkspaceFileSystem` 使用 `WorkspacePath`，不在各处直接拼接 `fetch("/api/files/...")`，也不把 `workspaceId` 塞进每个 `WorkspaceFileSystem` method。

Workspace API 使用结构化逻辑身份：

```text
workspaceId
WorkspacePath
operation payload
```

`WorkspacePath` 默认作为 JSON / structured field 传输，不放进会自动 percent-decode 的 URL path segment。只有 endpoint 确实必须经过 transport decode 时，规则固定为：transport decode once → 完整 WorkspacePath validation；应用层不得再次 decode。

服务器先 authorize `workspaceId`，再解析 server-owned root，然后调用 Backend adapter。API 不接受或返回 `root`、`basePath`、absolute path、host path、filesystem namespace 等 host filesystem 信息。

Browser 可提前执行 WorkspacePath validation 改善 UX，但 API boundary 与 Backend adapter 仍必须独立保证 server-side validation/security。Remote adapter 把 HTTP/transport/backend error 映射到 W-02 稳定 error semantics。

## 验证

- API read/write/list/CRUD 与 W-02 contract 一致。
- Remote adapter instance 绑定单一 workspace identity。
- WorkspacePath 结构化传输，不依赖 URL path percent-decoding。
- 未授权 workspace 在 Server boundary 被拒绝。
- traversal / encoded traversal / symlink escape 不能通过 API 绕过 Backend contract。
- error/permission/path 响应不泄露 host path。
- Node errno / HTTP status / fetch error 不泄露到 Workspace Core。

## 允许修改

```text
src/workspace/remote-*
src/server/workspace/api*
当前 API 所需 server route files
tests/unit/workspace/**
tests/integration/workspace/**
```

## 禁止修改

```text
src/editor/**
src/syntax/**
LSP
dependency versions
```

## 不要做

- 不实现 Desktop stdio 或 Neovim adapter。
- 不把 Remote adapter 抽象成 Universal Platform。
- 不允许客户端传 Backend filesystem root。
- 不为 WorkspacePath 设计 URL route encoding scheme。

---

# W-05 — Monaco Binding + Dirty Overlay

## 依赖

`W-01 PASS`, `W-02 PASS`, `W-03 PASS`, `W-04 PASS`

## 目标

打开文件时从 `WorkspaceFileSystem.readFile(path)` 初始化 Monaco Model；Model URI 由 `WorkspaceUriMapper.toUri(path)` 生成。Monaco Model 是唯一 unsaved text buffer；Dirty State 只维护 dirty/version metadata。

## 实现

Open：

```text
readFile(path)
→ create/reuse Monaco Model with canonical URI
→ create Syntax binding
→ dirty=false
```

同一个 canonical URI 不得同时存在多个 active Monaco Models。

Model change 只更新 Monaco 内容和 Dirty State，不写服务器文件，也不复制第二份 `Map<WorkspacePath, string>` 未保存文本 cache。

### Save Correctness（冻结）

同一个 Monaco Model 的 persisted save 写操作必须串行，避免较旧写请求后完成并覆盖较新的 Backend 内容；这是 per-model serialization，不引入全局 scheduler/queue framework。

每次 save 在请求时 capture：

```text
savedVersion = model.getVersionId()
savedContent = model.getValue()
```

随后按该 model 的 save sequence 执行：

```text
await WorkspaceFileSystem.writeFile(path, savedContent)
```

成功后只有当当前 `model.getVersionId() === savedVersion` 时才能清除 dirty；如果 save 期间发生新编辑，dirty 必须保持 true。write failure 始终保持 dirty。

一次 save failure 不得 poison per-model save sequence；失败请求结束后，后续已排队或新发起的 save 仍必须继续执行。

因此旧 save response 既不能清除较新的 dirty state，也不能通过 out-of-order write 把 Backend persisted content 回退到旧版本。

### Save Acceptance Evidence（冻结）

W-05 必须使用可控的 deferred/blocked `WorkspaceFileSystem.writeFile` 测试真实异步时序，而不是只断言同步调用顺序。测试至少主动制造：

```text
save(N) pending
→ edit to N+1
→ complete save(N)

save(N) pending
→ request save(N+1)
→ release writes in controlled order

save(N) rejects
→ save(N+1) continues and succeeds
```

验收必须同时断言：

- dirty state 最终值正确。
- Backend/persisted test adapter 的最终内容是最新成功保存版本。
- 第二次 persisted write 不会绕过 per-model serialization 提前执行。
- 第一次 save failure 不会让后续 save 永久停在 rejected chain。

只检查“调用过 `writeFile`”或只检查 queue 数量，不足以作为 W-05 PASS 证据。

## 验证

```text
open
edit
dirty=true
save
dirty=false
reopen
content persisted in Backend Workspace Filesystem

edit(version N)
start save(N)
edit(version N+1)
complete save(N)
dirty remains true

save(N) + save(N+1)
persisted writes remain ordered
latest saved version wins

save(N) fails
save(N+1) still executes
successful later save can persist and clear matching dirty version
```

## 允许修改

```text
src/workspace/**
src/editor/monaco/**
related workspace/editor tests
```

## 禁止修改

```text
Backend filesystem contract redesign
Workspace API redesign
LSP
dependency versions
```

## 可分配子 Agent

测试 Agent 可独立写 dirty/save race integration tests，不修改 filesystem contract。

---

# W-06 — Workspace Operations Lifecycle

## 依赖

`W-02 PASS`, `W-03 PASS`, `W-04 PASS`, `W-05 PASS`

## 目标

完成 LSP 前必须的操作：

```text
open
save
create
rename
delete
close
```

并冻结 Filesystem、Monaco Model、Dirty State、Syntax Session 的一致生命周期。

## 实现

所有影响 persisted filesystem 的操作遵守：

```text
validate
→ Backend persisted operation succeeds
→ reconcile Monaco / Dirty / Syntax derived state
```

Backend operation 失败时不提前修改 Monaco/Syntax identity state。Backend 已成功但 client derived-state reconciliation 失败时，以 Backend persisted result 为准并 reload/reconcile；不要反向 rollback persisted filesystem 去迁就 derived state。

### Open / Save / Create

- Open 与 Save 复用 W-05 contract。
- Create 只有 Backend create 成功后才更新 workspace UI/tree；第一版不要求 create 后自动 open。

### Rename

Dirty open file 不允许 rename；调用方必须先 save，或 discard + close。

Clean open file rename：

```text
Backend rename succeeds
→ dispose old Syntax binding/session
→ dispose old Monaco Model
→ remove old dirty/derived state
→ 如需保持打开状态，在 new canonical URI 重新创建/读取 Model
→ create new Syntax Session
```

禁止尝试修改 existing Monaco Model URI。

Directory rename 如果存在任何 open descendant（clean 或 dirty）→ reject。第一版不实现整棵目录 subtree 的 Model/Syntax URI migration。

### Delete

Dirty open file 不允许 delete；调用方必须先 save，或 discard + close。

Clean open file delete：Backend delete 成功后 dispose 对应 Monaco Model / Syntax Session，并移除 dirty/derived state。

Directory delete 如果存在任何 open descendant → reject。第一版仍只允许删除 empty directory，不实现 recursive delete。

### Close

```text
dispose Monaco Model
→ dispose Syntax binding/session
→ remove dirty metadata
```

`close` 本身不写 Backend，不自动 save 未保存 overlay。save/discard/cancel prompt 属于 UI policy；Workspace Core 不把 close 变成隐式 persistence。

如果未来实现 workspace switch，必须先明确 dirty overlay 的 save/discard/cancel 处理，再 dispose 旧 Workspace state；不要同时保留两个 `file:///workspace/...` namespace。

### Lifecycle Acceptance Evidence（冻结）

W-06 不能只验证 Map/registry 中“看不到旧 key”。针对 clean open file rename/delete/close，必须证明旧运行时资源真的失效：

- old Monaco Model 已 dispose，不再作为 active model 被复用。
- old Syntax binding/session 已执行 close/dispose。
- old URI/session 后续结果不能再刷新新 Model 或 workspace state。
- rename 后同时只存在 new canonical URI 对应的 active Model/Syntax Session。
- delete/close 后不存在旧 Model、旧 Syntax Session、旧 dirty metadata 或继续触发的旧 listener/callback。

测试可以使用现有 Syntax client 的可观察 request/close 行为或 active-session instrumentation；不要求为此新增通用 lifecycle framework。

## 验证

- open/save/create/rename/delete/close 都有 integration test。
- pending save 期间新编辑不会错误清 dirty。
- clean file rename 后旧 Path、canonical URI、Model、Syntax Session 不残留。
- rename/delete/close 明确断言 old Model disposed、old Syntax Session closed，旧结果/回调不再生效。
- dirty file rename/delete 被拒绝。
- directory rename/delete 在存在 open descendant 时被拒绝。
- Backend operation failure 不提前破坏 client identity state。
- close 不写回未保存 overlay。

## 允许修改

```text
src/workspace lifecycle/operation modules
src/editor/monaco workspace integration
必要的 Syntax adapter integration
related tests
```

## 禁止修改

```text
新增 filesystem capability
multi-workspace / multi-root
LSP
dependency versions
```

---

# W-07 — Backend Visibility Contract

## 依赖

`W-06 PASS`

## 目标

证明 Backend persisted filesystem 是后续 Language Server 读取的唯一文件视图，不建立 Browser Store → sync → Backend Store 的双存储模型。

## 实现

验证真实链路：

```text
Browser Model content A
  → save
  → RemoteWorkspaceFileSystem
  → Workspace API
  → BackendWorkspaceFileSystem.writeFile
  → real workspace file

BackendWorkspaceFileSystem.readFile(same WorkspacePath)
  → exactly A

Browser reopen
  → exactly A
```

Backend real path 不出现在 Browser / Domain / API success/error payload。

## 验证

- Browser save 后 Backend subsequent read 返回完全相同内容。
- Browser reopen 读取 Backend persisted content，而不是 Browser cache。
- canonical URI / WorkspacePath mapping 保持一致。
- API/Browser 中搜索不到 leaked host workspace root。

## 允许修改

```text
tests/integration/workspace/**
必要的最小 workspace integration harness
```

## 禁止修改

```text
新增 persisted storage abstraction
Browser file cache/sync engine
file watcher
LSP
```

## 不要做

- 不使用 “Browser ↔ Backend Workspace Sync” 作为架构模型。
- 不实现 didOpen/didChange。
- 不实现 file watcher。

---

# W-08 — Workspace Integration Gate

## 目标

建立 M2.5 的正式 production integration gate，证明 Browser → Workspace API → Backend filesystem 的真实链路、安全边界与 lifecycle，而不是只依赖 unit tests。

不为了 Gate 提前开发完整 Workspace Explorer；可以使用最小 Browser integration probe 驱动真实 RemoteWorkspaceFileSystem / API / Backend filesystem。

## 实现

只有 W-08 才允许在 verifier/tests 已实际存在后注册 `verify:m25`。继续复用 Vite+，禁止建设新的 runner、scheduler、DAG、cache 或 validation framework。

目标执行模型：

```text
pnpm install --frozen-lockfile
vp run verify:m25
```

`verify:m25` 应保持：

```text
validate/check/unit once
compatibility tsc once（如当前 Phase Gate 仍需要）
build once
production preview once
M2.5 regressions once
temporary workspace root/setup once
cleanup once
```

不得通过嵌套 `verify:m2 → verify:m25` 重复 build / preview；M2 sealed regressions 可以在同一 production preview 中直接复用其 regression suites。

### Real-chain Requirement（冻结）

W-08 的核心 persistence/security E2E 不允许用 mock 替代真实链路。必须实际包含：

```text
real browser context against production preview
→ real RemoteWorkspaceFileSystem
→ real Workspace API/HTTP route
→ real server-side authorization/root-resolution boundary
→ real BackendWorkspaceFileSystem
→ real temporary host workspace directory
```

允许使用受控 test fixture 提供“当前测试用户可访问哪个 workspaceId/root”的 server-owned mapping，但测试**不得绕过 authorization/root-resolution boundary**，也不得把 Backend filesystem 替换成 in-memory/mock store。

以下内容不能作为 W-08 核心证明的替代品：

- mock `fetch`。
- mock Workspace API handler。
- mock/in-memory `BackendWorkspaceFileSystem`。
- 只在 Browser 内断言保存后的 Monaco 内容。
- 只验证 request payload 而不读取真实 Backend persisted file。

Browser save 后必须由 server/backend 侧通过同一 `WorkspacePath` 对真实 temporary workspace 做 subsequent read，并验证 exact content；Browser reopen 也必须重新经过 Remote/API/Backend 链路读取 persisted content。

临时 workspace root 必须在 Gate 结束时 cleanup，包括测试失败路径；不要依赖人工清理。

## 验证矩阵

```text
Filesystem
  list/read/write/create file/create directory/rename/delete

Monaco lifecycle
  open/edit/dirty/save/close
  edit during pending save → dirty remains true
  multiple save requests → persisted write ordering correct
  failed save does not poison later save sequence

Operations
  clean file rename/delete
  dirty file rename/delete rejected
  directory rename/delete with open descendants rejected
  old Model/URI/Syntax Session disposed

WorkspacePath / Security
  root contract
  absolute/trailing/empty-segment/dot/dotdot/backslash/NUL rejected
  encoded traversal/backslash/NUL/slash rejected after transport handling
  symlink intermediate/target cannot escape root

Authorization / Isolation
  unauthorized workspaceId rejected before Backend adapter creation
  client cannot provide/override host root
  one IDE shell keeps one active canonical namespace

Persistence
  Browser save → Workspace API → Backend FS read-after-save exact content
  Browser reopen reads persisted Backend content

Architecture
  single persisted Source of Truth
  Monaco is unsaved buffer only
  Dirty State is metadata only
  host path isolation
```

## 允许修改

```text
tests/m25/**
minimal M2.5 verifier/integration probe
vite.config.ts（仅注册已经存在的 verify:m25 task）
```

## 禁止修改

```text
generic command runner
task scheduler
DAG/cache/plugin/validation framework
LSP implementation
new persisted storage
```

## Stop Rule

M2.5 未通过：

```text
禁止启动真实 Language Server
```
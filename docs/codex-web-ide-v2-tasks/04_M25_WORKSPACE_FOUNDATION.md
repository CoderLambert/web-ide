# 04 — M2.5 Workspace Foundation

进入条件：`M2 PASS`。

这是 LSP 的硬前置条件。

## Source of Truth 与 Web-first 边界（冻结）

```text
Backend Workspace Filesystem = persisted file content Source of Truth
Monaco Model                = open document / dirty overlay
Database                    = workspace metadata
```

M2.5 只保留薄的 `WorkspaceFileSystem` boundary，并且当前只实现 Web 所需的 adapter。Backend host 的 real path 只能存在于 adapter 内，不能泄露到 Browser / Domain。

禁止为同一份 persisted content 建立双 Source of Truth；Monaco 的未保存内容必须作为 overlay 管理，不能反向取代 Backend persisted content。Desktop / Neovim 仅作为未来架构边界检查，不在 M2.5 提前实现跨平台 filesystem/runtime adapter。

### 当前 Workspace Scope

M2.5 / M3 第一版只支持：

```text
one IDE shell = one active workspace
```

`file:///workspace/...` 只在当前 active workspace 内作为 canonical URI namespace。不要为了未来 multi-root / simultaneous multi-workspace 预先改 URI 方案。

如果未来实现 workspace switch，必须先处理 dirty state，再 dispose 当前 Workspace 的 Monaco Models / Syntax Sessions / derived state，之后才能激活新 Workspace；第一版不要求实现 multi-root。

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
src/main.ts     = 合法
src/lib/a.ts    = 合法
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

建立薄的文件系统能力边界，不在接口内存储文件正文，也不把 metadata Store 当作 persisted content Store。

## 实现

冻结最小 Web 所需接口：

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

接口只定义能力，不保存文件正文。Workspace metadata 由独立 metadata boundary 管理；M2.5 不建设 Git、search 或 filesystem index。

## 验证

接口 contract、path normalization 和 CRUD 行为测试通过。

## 并行

W-01 PASS 后可冻结接口；W-03 与 W-04 可以在接口冻结后并行实现。

---

# W-03 — BackendWorkspaceFileSystem

## 依赖

`W-01 PASS`, `W-02 PASS`

## 目标

实现 `WorkspacePath` 到 safe host path 的 Backend adapter，并实际读写 persisted workspace directory。

## 实现

它是 persisted file content 的唯一 Source of Truth。host path 只存在 adapter 内；Domain、Browser、Protocol 和响应 DTO 不得看到 host path。

Backend root 必须由服务器根据已授权的 `workspaceId` 解析：

```text
workspaceId
→ authorize workspace
→ resolve server-owned workspace root
→ validate WorkspacePath
→ safe filesystem operation
```

客户端不得提供、覆盖或推导 Backend host root。

Path security 不能只检查字符串 `..`。如果 filesystem 中存在 symlink，必须保证最终 target / parent resolution 仍位于已授权 workspace root 内；不得通过 symlink 逃逸 workspace。第一版可以选择明确的 symlink policy，但不能静默跟随到 root 外。

## 验证

- 防止 `../`、encoded traversal 和绝对路径逃逸 Workspace。
- symlink escape 被拒绝或按明确 policy 安全处理。
- rename/delete/create 路径行为正确。
- workspace root containment 和 WorkspacePath contract 正确。
- 协议响应不泄露 host path。
- 未授权 `workspaceId` 无法访问 filesystem。

## 不要做

- 不实现 Remote adapter。
- 不启动 Language Server。

---

# W-04 — Workspace API / RemoteWorkspaceFileSystem

## 依赖

`W-02 PASS`；API contract 不依赖 Backend host path。

## 目标

建立当前 Web 所需的薄 Remote adapter：

```text
Browser
  → RemoteWorkspaceFileSystem
  → Workspace API
  → BackendWorkspaceFileSystem
```

## 实现

浏览器业务代码通过 `RemoteWorkspaceFileSystem` 使用 `WorkspacePath`，不在各处直接拼接 `fetch("/api/files/...")`。

Workspace API 使用结构化逻辑身份：

```text
workspaceId
WorkspacePath
operation payload
```

服务器先授权 `workspaceId`，再使用 server-owned root 执行路径解析。API 不接受 host root/path，也不把 host path 返回 Browser。

优先把 `WorkspacePath` 作为 JSON/结构化字段传输；如果某个 endpoint 必须经过 URL decode，decode 后仍必须执行完整 WorkspacePath validation。

## 验证

- API read/write/list/CRUD contract 正确。
- 未授权 workspace 被拒绝。
- path traversal / symlink escape 不能通过 API 绕过 Backend contract。
- 错误、权限和 path 响应不泄露 host path。

## 不要做

- 不实现 Desktop stdio 或 Neovim adapter。
- 不把 Remote adapter 抽象成 Universal Platform。
- 不允许客户端传 Backend filesystem root。

---

# W-05 — Monaco Binding + Dirty Overlay

## 依赖

`W-01 PASS`, `W-02 PASS`, `W-03 PASS`, `W-04 PASS`

## 目标

打开文件时从 `WorkspaceFileSystem.readFile(path)` 初始化 Monaco Model；Model URI 由 `WorkspaceUriMapper.toUri(path)` 生成。

## 实现

Model change 标记 dirty；save 时调用 `WorkspaceFileSystem.writeFile(path, model.getValue())`，成功后清除 dirty。每次按键只更新 Monaco dirty overlay，不写服务器文件。

## 验证

```text
open
edit
dirty=true
save
dirty=false
reopen
content persisted in Backend Workspace Filesystem
```

## 可分配子 Agent

测试 Agent 可独立写 dirty/save integration tests。

---

# W-06 — Workspace Operations Lifecycle

## 依赖

`W-02`, `W-03`, `W-04`, `W-05 PASS`

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

## 实现

统一验证 Filesystem、Monaco Model、Dirty State、Syntax Session 的生命周期一致；不创建第二份 persisted content。

## 验证

每个操作做 integration test，重点验证 rename/delete 后旧 Path、canonical URI、Model 和 Syntax Session 不残留；close 不写回未保存 overlay。

如果实现 workspace switch，必须先明确 dirty overlay 的 save/discard/cancel 处理，再 dispose 旧 Workspace state；不要同时保留两个 `file:///workspace/...` namespace。

---

# W-07 — Backend Visibility Contract

## 依赖

`W-06 PASS`

## 目标

验证 Backend persisted filesystem 是后续 Language Server 读取的唯一文件视图，不建立 Browser Store → sync → Backend Store 的双存储模型。

## 实现

验证：

```text
Browser save
  → RemoteWorkspaceFileSystem
  → Workspace API
  → BackendWorkspaceFileSystem
  → real workspace file
```

## 验证

Browser 保存文件后，Backend subsequent read 通过同一 `WorkspacePath` / canonical URI mapping 能读取同样内容；Backend real path 不出现在 Browser / Domain。

## 不要做

- 不使用 “Browser ↔ Backend Workspace Sync” 作为架构模型。
- 不实现 didOpen/didChange。
- 不实现 file watcher。

---

# W-08 — Workspace Integration Gate

## 验证

```text
open/save
create
rename
delete
close
dirty overlay
single active workspace scope
WorkspacePath contract
canonical URI round-trip
path traversal protection
symlink escape protection
workspace authorization
client cannot provide host root
Browser save → Workspace API → Backend FS read-after-save
single persisted Source of Truth
host path isolation
Backend read-after-save consistency
```

## Stop Rule

M2.5 未通过：

```text
禁止启动真实 Language Server
```

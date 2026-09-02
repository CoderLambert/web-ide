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

## 验证

同一路径在 Browser / Backend mapper 中 round-trip 一致；非法、越界或非 canonical URI 被拒绝。

## 不要做

- 不实现文件内容存储。
- 不接 LSP。

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

## 验证

- 防止 `../` 逃逸 Workspace。
- rename/delete/create 路径行为正确。
- workspace jail 和 path normalization 正确。
- 协议响应不泄露 host path。

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

浏览器业务代码通过 `RemoteWorkspaceFileSystem` 使用 `WorkspacePath`，不在各处直接拼接 `fetch("/api/files/...")`。API 只传 WorkspacePath、canonical URI 所需的逻辑身份和文件内容，不传 host path。

## 验证

API read/write/list/CRUD contract 正确；错误、权限和 path traversal 响应不泄露 host path。

## 不要做

- 不实现 Desktop stdio 或 Neovim adapter。
- 不把 Remote adapter 抽象成 Universal Platform。

---

# W-05 — Monaco Binding + Dirty Overlay

## 依赖

`W-01 PASS`, `W-02 PASS`, `W-04 PASS`

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
canonical URI
path traversal protection
Browser save → Workspace API → Backend FS read-after-save
single persisted Source of Truth
WorkspacePath normalization
canonical URI mapping
host path isolation
Backend read-after-save consistency
```

## Stop Rule

M2.5 未通过：

```text
禁止启动真实 Language Server
```

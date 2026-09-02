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

# W-01 — WorkspaceIdentity + Canonical URI

## 目标

冻结 Browser / Backend / LSP 共用的 Workspace 和 URI Contract。

## 实现

定义：

```ts
interface WorkspaceIdentity {
  id: string;
  rootUri: string;
}

interface WorkspaceFile {
  uri: string;
  languageId?: string;
  version?: number;
}
```

统一逻辑路径：

```text
file:///workspace/...
```

## 验证

同一路径在 Browser/Backend mapper 中 round-trip 一致。

## 不要做

- 不写文件内容 Store。
- 不接 LSP。

---

# W-02 — WorkspaceStore

## 依赖

`W-01 PASS`

## 目标

建立项目文件元数据和 persisted content 的 Source of Truth。

## 实现

支持最小：

```text
get
list
create
update/save
delete
```

先以适合当前项目的简单 Store 实现，不提前设计 Git/index/search。

## 验证

基本 CRUD 单元测试通过。

## 并行

可与 `W-03` 并行，前提是双方只依赖 W-01 已冻结接口。

---

# W-03 — FileStore / Backend Adapter

## 依赖

`W-01 PASS`

## 目标

实现逻辑 Workspace URI 到 Backend 实际存储路径的封装。

## 实现

Backend 真实路径只存在 adapter 内。上层永远只使用 canonical URI。

## 验证

- 防止 `../` 逃逸 Workspace。
- rename/delete/create 路径行为正确。
- 协议响应不泄露 host path。

## 不要做

- 不启动 Language Server。

---

# W-04 — Monaco Model ↔ Workspace Binding

## 依赖

`W-02 PASS`

## 目标

打开 WorkspaceFile 时创建/复用对应 Monaco Model；关闭时保持正确生命周期。

## 实现

Model URI 必须使用 canonical URI。Model 内容初始化自 WorkspaceStore。

## 验证

同一 URI 不创建重复 Model；关闭/reopen 内容正确。

---

# W-05 — Dirty Overlay

## 依赖

`W-04 PASS`

## 目标

明确 persisted file 与未保存 Monaco buffer 的差异。

## 实现

Model change 标记 dirty；save 后同步 WorkspaceStore 并清除 dirty。不要每次按键都写 backend file。

## 验证

```text
open
edit
dirty=true
save
dirty=false
reopen
content persisted
```

## 可分配子 Agent

测试 Agent 可独立写 dirty/save integration tests。

---

# W-06 — Workspace Operations

## 依赖

`W-02`, `W-03`, `W-04 PASS`

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

确保 Store、Backend adapter、Monaco Model 三方状态一致。

## 验证

每个操作做 integration test，重点验证 rename/delete 后旧 URI 不残留。

---

# W-07 — Browser ↔ Backend Workspace Sync

## 依赖

`W-06 PASS`

## 目标

让 Backend Workspace 具有 Language Server 后续需要的已保存文件快照。

## 实现

建立最小同步 API/transport。只同步 Workspace 文件，不启动 Language Server。

## 验证

Browser 保存文件后，Backend 通过 canonical URI 能读取同样内容。

## 不要做

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
Browser ↔ Backend content consistency
```

## Stop Rule

M2.5 未通过：

```text
禁止启动真实 Language Server
```

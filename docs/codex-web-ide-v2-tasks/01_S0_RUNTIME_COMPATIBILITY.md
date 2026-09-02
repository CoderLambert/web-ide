# 01 — S0 Runtime Compatibility

目标：在写 Language Framework 前，证明稳定依赖栈可以在真实 production build 中运行。

**本阶段只验证兼容性，不实现正式 IDE 架构。**

---

# S0-01 — 初始化 TanStack Start Shell

## 目标

创建最小 TanStack Start + React + TypeScript 项目，并建立 `/ide` client-only route。

## 实现

使用成熟稳定的项目模板初始化项目。`/ide` 设置 `ssr: false`，页面只渲染一个最小占位内容；不要接 Monaco、Tree-sitter、LSP。

## 允许修改

```text
package.json
pnpm-lock.yaml
src/routes/*
基础配置文件
```

## 验证

```text
pnpm install --frozen-lockfile   # 首次生成 lockfile 后 CI 使用
pnpm dev
pnpm build
```

确认 `/ide` 可访问且 production build 通过。

## 不要做

- 不接 Monaco。
- 不建 Language Registry。
- 不建 Workspace。
- 不实现 IDE UI。

## 并行

不建议并行。项目骨架是后续任务共同依赖。

---

# S0-02 — 锁定 Monaco 稳定组合

## 依赖

`S0-01 PASS`

## 目标

验证稳定的 Monaco Compatibility Group 能在 `/ide` 正常 create/dispose/remount。

首选候选：

```text
monaco-editor              0.55.1
monaco-languageclient      10.7.0
@codingame/monaco-vscode-api 25.1.2
```

最终以实际安装兼容结果为准，但不要主动追 newer / next。

## 实现

只接入 Monaco 最小 Editor + Model 生命周期。增加一个最小测试页面，验证 route mount/unmount 后 Editor、Model 和 Provider 都能正确释放。

## 验证

- Editor 可创建。
- Model 可创建。
- route remount 后无重复注册异常。
- dispose 后无明显残留。
- `pnpm build` 通过。

## 不要做

- 不实现语法高亮。
- 不连接 Language Server。
- 不建立正式 Model Manager 抽象。

## 可分配子 Agent

### Test Agent

只负责生命周期测试方案和测试代码，不修改 Monaco 初始化实现。

---

# S0-03 — Web Worker + web-tree-sitter Runtime

## 依赖

`S0-02 PASS`

## 目标

验证 Web Worker 和稳定候选 `web-tree-sitter` 可以在 dev 与 production bundle 中运行。

首选候选：

```text
web-tree-sitter 0.25.10
tree-sitter-cli 0.25.10
```

## 实现

创建最小 Worker，只负责初始化 `tree-sitter.wasm` 并返回 ready/error。不要加入正式 Worker Protocol。

## 验证

```text
pnpm dev
pnpm build
pnpm preview
```

浏览器中 Worker 能成功初始化 Runtime。

## 不要做

- 不建 DocumentSession。
- 不实现增量 parse。
- 不实现 WorkerSupervisor。

## 可分配子 Agent

### Build Verification Agent

只检查 Vite production bundle、WASM 路径和 Worker 产物，不修改 Worker 业务逻辑。

---

# S0-04 — 固定 SQL Grammar 并自行构建 WASM

## 依赖

`S0-03 PASS`

## 目标

固定一个 SQL grammar commit，并使用固定 `tree-sitter-cli` 自行构建 `tree-sitter-sql.wasm`。

## 实现

记录 grammar repository + revision；加入最小构建脚本，生成 WASM 并计算 SHA256。禁止下载未知预编译 WASM。

## 产物

```text
public/languages/sql/tree-sitter-sql.wasm
临时或正式 build script
grammar revision
WASM SHA256
```

## 验证

同一 revision 重复构建后产物可加载；Worker 能 `Language.load()` SQL WASM。

## 不要做

- 不同步 Query。
- 不实现 SQL LanguageDefinition。
- 不写 SQL 专用 Engine。

## 可分配子 Agent

### Asset Verification Agent

只验证 grammar revision、构建命令、SHA256 和 WASM 可加载性。

---

# S0-05 — Worker 内最小 SQL Parse

## 依赖

`S0-04 PASS`

## 目标

证明：

```text
Worker
→ Parser.init
→ Language.load
→ parser.setLanguage
→ parse SQL
```

完整链路成立。

## 实现

给 Worker 发送一条固定 SQL 字符串，返回根节点类型、错误状态和简单 tree string/debug output。只做 Spike，不设计正式协议。

## 验证

输入：

```sql
SELECT id, name FROM users WHERE active = true;
```

Worker 返回合法 Syntax Tree；`pnpm build && pnpm preview` 下同样通过。

## 不要做

- 不接 Monaco change event。
- 不做增量 parse。
- 不做 AST Inspector UI。

---

# S0-06 — 最小 LSP WebSocket / JSON-RPC 链路

## 依赖

`S0-02 PASS`

可与 `S0-04/S0-05` 在**不同文件范围**并行。

## 目标

证明当前 Monaco/LSP Client 依赖组合能建立最小 WebSocket JSON-RPC 通信。

## 实现

创建最小 mock/minimal JSON-RPC server 或现有测试 server，只验证 initialize/消息往返。不要启动真实 SQL Language Server。

## 验证

浏览器能：

```text
connect
initialize/request
receive response
disconnect
reconnect
dispose
```

production build 下成立。

## 不要做

- 不实现 Completion。
- 不实现 Diagnostics。
- 不设计 LSP Gateway 正式架构。

## 可分配子 Agent

### LSP Spike Agent

独立实现最小 LSP 链路；只允许修改 spike/test 目录和必要依赖配置。

---

# S0-07 — Production Compatibility Gate

## 依赖

`S0-01 ... S0-06 PASS`

## 目标

对整个 S0 运行一次真实 production 验证。

## 实现

不新增功能，只修复 S0 范围内构建/资源路径/生命周期问题。

## 必须验证

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm preview
E2E: /ide
E2E: Monaco mount/unmount
E2E: Worker init
E2E: SQL WASM parse
E2E: LSP minimal reconnect
```

## Stop Rule

任意核心链路失败：

```text
S0 = FAIL
禁止进入 M1
```

---

# S0-08 — 冻结 Runtime

## 依赖

`S0-07 PASS`

## 目标

把已经实际验证的版本和构建环境写入正式记录。

## 产物

```text
docs/adr/ADR-001-runtime-stack.md
runtime-lock.json
pnpm-lock.yaml
```

## ADR 必须记录

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
SQL grammar repository/revision
WASM SHA256
验证命令
production 验证结果
```

## 验证

重新从 clean install 使用 lockfile 构建通过。

## 完成条件

`S0 PASS`，然后停止并进入 Review Gate。

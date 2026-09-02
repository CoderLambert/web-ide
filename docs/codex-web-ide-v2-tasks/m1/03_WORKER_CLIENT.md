# M1-05 ~ M1-07 — Worker Host / Supervisor / Client

## M1-05 WorkerHost / FIFO Dispatcher

依赖：`M1-02 PASS`, `M1-03 PASS`, `M1-04 PASS`

### 目标
建立正式 Worker 消息入口。

### 允许修改
```text
src/syntax/tree-sitter/worker/worker.ts
tests/unit/syntax/*worker-host*
```

### 职责
```text
receive unknown
-> decode/validate
-> global FIFO queue
-> dispatch
-> structured response/error
-> postMessage
```

Worker 初始化完成发送合法 `WorkerReady`。

每个 request 自己 catch；一个 request 失败不能 poison FIFO Promise chain。

### 验证
- 消息严格 FIFO。
- invalid request 返回 structured error，不 crash。
- 一个 request throw 后下一 request 仍执行。
- WorkerReady protocolVersion 正确。

### 禁止
不做业务逻辑、并发 scheduler、多个 Worker。

---

## M1-06 WorkerSupervisor Core

依赖：`M1-05 PASS`

### 目标
只建立 Worker 生命周期，不做文档恢复。

### 允许修改
```text
src/syntax/tree-sitter/worker-supervisor.ts
tests/unit/syntax/*supervisor*
```

### 实现
状态：
```text
stopped -> starting -> ready -> failed
```

负责：
```text
spawn
terminate
workerGeneration++
wait WorkerReady
ignore old worker events
```

### 验证
- generation 每次新 Worker 增加。
- 旧 Worker event 不影响新 Worker。
- terminate clean。
- 非法/mismatch ready 不进入 ready。

### 禁止
不 import Monaco；不做 document recovery；不无限 retry。

---

## M1-07 TreeSitterClient

依赖：`M1-02 PASS`, `M1-05 PASS`, `M1-06 PASS`

### 目标
主线程拥有 typed request client，并过滤 stale result。

### 允许修改
```text
src/syntax/tree-sitter/client.ts
tests/unit/syntax/*client*
```

### 职责
```text
requestId
pending map
typed protocol
workerGeneration filter
session filter
documentVersion filter
```

Worker terminate/restart 时，旧 generation pending Promise 必须立即 reject/cancel，不能悬挂。

### 验证
构造：
```text
old generation
old session
old document version
```
全部 drop。

验证 Worker terminate 后 pending count = 0。

### 禁止
不接 Monaco、不处理 UTF-8、不实现 Recovery。

## Stop Rule
M1-05/06/07 分别独立 commit/push；Client 不得承担 Supervisor 或 Monaco 职责。
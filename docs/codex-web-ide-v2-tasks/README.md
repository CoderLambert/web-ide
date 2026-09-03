# Web IDE V2 — Codex 执行任务包

本目录把《TanStack Start + Monaco + Tree-sitter + LSP 多语言 Web IDE 实施方案 V2》拆成可直接交给 Codex 顺序执行的任务。

## 当前状态

```text
S0 Runtime Compatibility   PASS / sealed
M1 Syntax Foundation       PASS / sealed
M2 Syntax UX               PASS / sealed
M2.5 Workspace Foundation  active
W-01                       PASS / sealed
Next                       W-02 WorkspaceFileSystem Contract
```

当前执行入口是 `04_M25_WORKSPACE_FOUNDATION.md`；M2 已 sealed，不因 M2.5 开发重新打开。W-01 已完成并 sealed，后续从 W-02 开始。

## 使用方式

只给 Codex 当前阶段文档，不要一次把所有阶段都要求实现。

推荐顺序：

```text
00_GLOBAL_RULES.md
        ↓
01_S0_RUNTIME_COMPATIBILITY.md
        ↓ Review Gate
02_M1_SYNTAX_FOUNDATION.md
        ↓ Review Gate
03_M2_SYNTAX_UX.md
        ↓ Review Gate
04_M25_WORKSPACE_FOUNDATION.md
        ↓ Review Gate
05_M3_LSP_SEMANTIC.md
        ↓ Review Gate
06_M4_MULTILANGUAGE_VALIDATION.md
        ↓ Review Gate
07_M5_DEBUG_ADVANCED.md
```

辅助文档：

```text
08_REVIEW_GATES.md
09_SUBAGENT_PLAYBOOK.md
10_TASK_TEMPLATE.md
TASK_INDEX.md
```

## 文档优先级

主 V2 文档负责长期架构方向；当前阶段文档负责可执行细节。若任务编号、依赖、DTO、脚本名或阶段实现细节出现冲突，按 `00_GLOBAL_RULES.md` 的文档优先级处理，不把旧示例和新任务混合实现。

## 执行原则

每次只执行一个 Task ID。

每个任务必须遵循：

```text
读取当前状态
→ 实现当前功能
→ 本地验证
→ 修复当前任务内的问题
→ 汇报结果
→ 停止
```

不要自动进入下一任务。

## 主 Agent 的职责

主 Agent 负责：

- 确认当前 Task 的依赖已经满足。
- 控制修改范围。
- 分配不会互相改同一批文件的子 Agent。
- 集成子 Agent 结果。
- 执行最终验证。
- 在完成当前 Task 后停止。

## 子 Agent 的使用原则

子 Agent 只用于：

1. 文件边界清晰的独立实现。
2. 独立测试。
3. 独立 Review。
4. 技术 Spike / 兼容性验证。

禁止为了“看起来并行”而把强依赖任务并行执行。M2.5 的 W-03 → W-04 明确串行；仅允许 ownership 独立的 security fixtures、dirty/save race tests、read-only review 等辅助工作并行。

## Stop Rule

```text
S0 不通过 → 禁止进入 M1
M1 不通过 → 禁止进入 M2
M2 不通过 → 禁止进入 M2.5
M2.5 不通过 → 禁止进入 M3
M3 Security Gate 不通过 → 禁止生产部署
第二语言需要修改通用 runtime/protocol/core → M4 FAIL
```

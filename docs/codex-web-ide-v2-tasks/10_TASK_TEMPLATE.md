# Codex Atomic Task Template

将下面内容复制后替换 `<...>`。

---

# <TASK-ID> — <TITLE>

## 依赖

```text
<PREVIOUS TASK PASS>
```

## 目标

<用 1-2 句话说明当前功能。>

## 当前上下文

<只提供当前任务需要知道的接口/模块。>

## 实现

<2-4 句话。描述最小实现，不写后续扩展。>

## 允许修改

```text
<path>
<path>
```

## 禁止修改

```text
<path>
<dependency versions>
```

## 验证

```text
<command>
<command>
```

验收：

- <condition>
- <condition>

## 不要做

- 不实现下一 Task。
- 不做无关重构。
- 不升级无关依赖。

## 子 Agent

`允许 / 不允许`

如果允许：

```text
Agent A:
  ownership:
  goal:
  validation:

Agent B:
  ownership:
  goal:
  validation:
```

## 完成后汇报

```markdown
## Result

Status: PASS | BLOCKED | FAIL

### Changed

- ...

### Implemented

- ...

### Validation

- `...` → PASS

### Notes

- ...

### Follow-ups

- ...
```

完成后停止。

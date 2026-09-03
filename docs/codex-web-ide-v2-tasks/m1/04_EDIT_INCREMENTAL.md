# M1-08 ~ M1-09 — EditCodec / Incremental Parse

## M1-08 EditCodec

依赖：`M1-02 PASS`

### 目标

冻结 Monaco / Project Protocol 与 `web-tree-sitter` JavaScript API 的 UTF-16
code-unit 坐标语义。

### 允许修改

```text
src/syntax/tree-sitter/edit-codec.ts
tests/unit/syntax/*edit-codec*
```

### 规则

一个 Monaco content-change event = 一个原子 EditTransaction。

Protocol 输入保持：

```text
rangeOffset / rangeLength = UTF-16 code unit
text = replacement text
```

EditCodec 内部负责：

```text
UTF-16 offset -> Tree-sitter JavaScript Point/InputEdit
```

`web-tree-sitter` WASM binding 再负责把 JavaScript API 坐标转换到
Tree-sitter native byte representation。业务代码和 Adapter 不得自行把
`web-tree-sitter` JavaScript `InputEdit` / `Point` 转成 UTF-8 byte offset 或
byte column。

坐标 Source of Truth：

```text
Monaco / Project Protocol:
UTF-16 code-unit offset / column

        ↓

web-tree-sitter JavaScript API:
UTF-16 code-unit index / column

        ↓

web-tree-sitter WASM binding:
内部负责转换到 Tree-sitter native byte representation
```

### 必测

```text
ASCII
中文
emoji
中文+emoji
LF / CRLF
insert/delete/replace
multi-line
batch changes
multi cursor
undo/redo representative edits
```

每例至少证明：

```text
stagedText === expectedText
InputEdit ranges 合法
```

### 禁止

不改 DocumentManager、不接 Monaco、不引入 Rope/Piece Table。

---

## M1-09 ApplyChanges / Incremental Parse / ChangedRanges

依赖：`M1-04 PASS`, `M1-05 PASS`, `M1-08 PASS`

### 目标

实现原子、可证明的 Tree-sitter incremental parse。

### 允许修改

```text
src/syntax/tree-sitter/worker/document-manager.ts
必要的 worker syntax tests
```

### Version Contract

```ts
if (session.documentVersion !== request.baseVersion) {
  return RESYNC_REQUIRED;
}
```

不要假设 `nextVersion = baseVersion + 1`。

### Transaction

```text
1 validate session/baseVersion
2 validate all changes against current mirror
3 build stagedText + all InputEdit
4 only after all validation succeeds: oldTree.edit(...)
5 parser.parse(stagedText, oldTree)
6 oldTree.getChangedRanges(newTree)
7 convert ranges to project TextRange (0-based UTF-16)
8 delete oldTree
9 atomically commit text/tree/version/state
```

### Failure Rule

验证阶段失败：session 完全不变。

一旦 `tree.edit()` 已发生而后续失败：

```text
delete old tree
state = desynced
return RESYNC_REQUIRED
```

禁止 rollback/继续复用该 Tree。

### ParseResult

热路径只返回：

```text
documentUri
sessionId
documentVersion
parseTimeMs
hasErrors
changedRanges: TextRange[]
```

不得序列化整棵 AST。

### 验证

- incremental tree 与 full reparse 等价。
- Worker textMirror 与 expected text 相同。
- Unicode/CRLF/batch/multi-cursor 正确。
- version mismatch 不修改 session。
- incremental failure 进入 desynced/resync。
- changedRanges 使用项目的 0-based UTF-16 `TextRange`，不泄露 Tree-sitter
  native byte point。

## Stop Rule

M1-08 可独立并行；M1-09 必须等待依赖 PASS。两项分别 commit/push。

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type { DocumentSyntaxCapabilityRegistry } from "@/editor/monaco/document-capability-registry";
import type { SelectionCoordinator } from "@/editor/monaco/selection-provider";
import type { SyntaxSelectionPath } from "@/syntax/types";

export type SqlQuerySourceMode = "current" | "selection" | "all";

export interface SqlQuerySourceEditor {
  getModel(): Monaco.editor.ITextModel | null;
  getPosition(): Pick<Monaco.Position, "lineNumber" | "column"> | null;
  getSelection(): Monaco.ISelection | null;
}

export async function resolveSqlQuerySource(
  mode: SqlQuerySourceMode,
  editor: SqlQuerySourceEditor,
  registry: DocumentSyntaxCapabilityRegistry,
): Promise<string | undefined> {
  const model = editor.getModel();
  if (model === null || model.isDisposed()) {
    return undefined;
  }

  switch (mode) {
    case "all":
      return model.getValue();
    case "selection": {
      const selection = editor.getSelection();
      if (selection === null) {
        return undefined;
      }
      const range = {
        startLineNumber: Math.min(selection.selectionStartLineNumber, selection.positionLineNumber),
        startColumn:
          selection.selectionStartLineNumber <= selection.positionLineNumber
            ? selection.selectionStartColumn
            : selection.positionColumn,
        endLineNumber: Math.max(selection.selectionStartLineNumber, selection.positionLineNumber),
        endColumn:
          selection.selectionStartLineNumber <= selection.positionLineNumber
            ? selection.positionColumn
            : selection.selectionStartColumn,
      };
      if (range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn) {
        return undefined;
      }
      return model.getValueInRange(range);
    }
    case "current": {
      const position = editor.getPosition();
      if (position === null) {
        return undefined;
      }
      const capabilities = registry.get(model.uri.toString());
      if (capabilities === undefined) {
        return undefined;
      }
      return resolveCurrentSql(model, position, capabilities.selection);
    }
  }
}

export async function resolveCurrentSql(
  model: Monaco.editor.ITextModel,
  position: Pick<Monaco.Position, "lineNumber" | "column">,
  coordinator: Pick<SelectionCoordinator, "request">,
): Promise<string | undefined> {
  const version = model.getVersionId();
  const [selection] = await coordinator.request(version, [
    {
      line: position.lineNumber - 1,
      character: position.column - 1,
    },
  ]);

  if (model.isDisposed() || model.getVersionId() !== version) {
    return undefined;
  }

  const range = (selection as SyntaxSelectionPath | undefined)?.ranges.at(-1);
  if (range === undefined) {
    return undefined;
  }

  return model.getValueInRange({
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  });
}

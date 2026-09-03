import { describe, expect, it } from "vite-plus/test";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import { DocumentSyntaxCapabilityRegistry } from "@/editor/monaco/document-capability-registry";
import {
  resolveCurrentSql,
  resolveSqlQuerySource,
  type SqlQuerySourceEditor,
} from "@/features/sql-lab/query-source";

function createModel() {
  let version = 7;
  return {
    uri: { toString: () => "workspace://sql-lab/query.sql" },
    isDisposed: () => false,
    getVersionId: () => version,
    getValue: () => "SELECT dirty_value;\nSELECT second;",
    getValueInRange: (range: unknown) => JSON.stringify(range),
    bumpVersion: () => {
      version += 1;
    },
  };
}

function createEditor(
  model: ReturnType<typeof createModel>,
  mode: "empty" | "selected" = "selected",
): SqlQuerySourceEditor {
  return {
    getModel: () => model as unknown as Monaco.editor.ITextModel,
    getPosition: () => ({ lineNumber: 1, column: 8 }),
    getSelection: () =>
      mode === "empty"
        ? ({
            selectionStartLineNumber: 1,
            selectionStartColumn: 1,
            positionLineNumber: 1,
            positionColumn: 1,
          } as never)
        : ({
            selectionStartLineNumber: 1,
            selectionStartColumn: 1,
            positionLineNumber: 1,
            positionColumn: 19,
          } as never),
  };
}

describe("SQL Lab query source", () => {
  it("reads All from the dirty Monaco model and Selection from its exact range", async () => {
    const model = createModel();
    const registry = new DocumentSyntaxCapabilityRegistry();
    const editor = createEditor(model);

    await expect(resolveSqlQuerySource("all", editor, registry)).resolves.toBe(
      "SELECT dirty_value;\nSELECT second;",
    );
    await expect(resolveSqlQuerySource("selection", editor, registry)).resolves.toBe(
      JSON.stringify({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 19,
      }),
    );
  });

  it("uses the current URI's SelectionCoordinator and the outermost range", async () => {
    const model = createModel();
    const coordinator = {
      request: async () => [
        {
          ranges: [
            {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 6 },
            },
            {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 19 },
            },
          ],
        },
      ],
    };
    const otherCoordinator = {
      request: async () => [
        {
          ranges: [
            {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          ],
        },
      ],
    };
    const registry = new DocumentSyntaxCapabilityRegistry();
    registry.register(model.uri.toString(), {
      selection: coordinator,
      highlight: {},
      folding: {},
    } as never);
    registry.register("workspace://sql-lab/other.sql", {
      selection: otherCoordinator,
      highlight: {},
      folding: {},
    } as never);

    const result = await resolveSqlQuerySource("current", createEditor(model), registry);
    expect(result).toContain('"endLineNumber":1');
    expect(result).toContain('"endColumn":20');
  });

  it("returns no source for empty selection or stale current model", async () => {
    const model = createModel();
    const registry = new DocumentSyntaxCapabilityRegistry();
    const editor = createEditor(model, "empty");
    await expect(resolveSqlQuerySource("selection", editor, registry)).resolves.toBeUndefined();

    const staleCoordinator = {
      request: async () => {
        model.bumpVersion();
        return [{ ranges: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }] }];
      },
    };
    registry.register(model.uri.toString(), {
      selection: staleCoordinator,
      highlight: {},
      folding: {},
    } as never);
    await expect(
      resolveSqlQuerySource("current", createEditor(model), registry),
    ).resolves.toBeUndefined();
    await expect(
      resolveCurrentSql(
        model as unknown as Monaco.editor.ITextModel,
        { lineNumber: 1, column: 1 },
        staleCoordinator,
      ),
    ).resolves.toBeUndefined();
  });
});

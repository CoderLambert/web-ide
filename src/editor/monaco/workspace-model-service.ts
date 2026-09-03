import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

export interface WorkspaceModelService {
  createModel(
    content: string,
    languageId: string | undefined,
    uri: string,
  ): Monaco.editor.ITextModel;
}

export interface MonacoWorkspaceRuntime {
  Uri: {
    parse(uri: string): Monaco.Uri;
  };
  editor: {
    createModel(
      content: string,
      languageId: string | undefined,
      uri: Monaco.Uri,
    ): Monaco.editor.ITextModel;
  };
}

export class MonacoWorkspaceModelService implements WorkspaceModelService {
  readonly #monaco: MonacoWorkspaceRuntime;

  constructor(monaco: MonacoWorkspaceRuntime) {
    this.#monaco = monaco;
  }

  createModel(
    content: string,
    languageId: string | undefined,
    uri: string,
  ): Monaco.editor.ITextModel {
    return this.#monaco.editor.createModel(content, languageId, this.#monaco.Uri.parse(uri));
  }
}

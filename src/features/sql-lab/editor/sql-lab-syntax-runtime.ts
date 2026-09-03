import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import {
  DocumentSyntaxCapabilityRegistry,
  type DocumentSyntaxCapabilityDisposable,
} from "@/editor/monaco/document-capability-registry";
import {
  HighlightCoordinator,
  registerSemanticHighlightProvider,
} from "@/editor/monaco/highlight-coordinator";
import { FoldingCoordinator, registerFoldingRangeProvider } from "@/editor/monaco/folding-provider";
import {
  createSelectionRangeProvider,
  registerSelectionRangeProvider,
  SelectionCoordinator,
} from "@/editor/monaco/selection-provider";
import {
  MonacoSyntaxDocumentBinding,
  type SyntaxDocumentClient,
} from "@/editor/monaco/syntax-document-binding";
import type { WorkspaceSyntaxBinding } from "@/workspace/workspace-document-manager";
import { TreeSitterClient, type TreeSitterClientRequest } from "@/syntax/tree-sitter/client";
import { WorkerSupervisor } from "@/syntax/tree-sitter/worker-supervisor";

const SESSION_PREFIX = "sql-lab";

interface BoundDocument {
  readonly model: Monaco.editor.ITextModel;
  readonly binding: MonacoSyntaxDocumentBinding;
  readonly highlights: HighlightCoordinator;
  readonly folding: FoldingCoordinator;
  readonly selection: SelectionCoordinator;
  readonly registration: DocumentSyntaxCapabilityDisposable;
  readonly dispose: () => void;
}

export interface SqlLabSyntaxRuntimeOptions {
  onError?: (error: unknown) => void;
}

export class SqlLabSyntaxRuntime {
  readonly #monaco: typeof Monaco;
  readonly #onError: ((error: unknown) => void) | undefined;
  readonly #registry = new DocumentSyntaxCapabilityRegistry();
  #supervisor: WorkerSupervisor | undefined;
  #worker: Worker | undefined;
  #client: TreeSitterClient | undefined;
  #semanticRegistration: Monaco.IDisposable | undefined;
  #foldingRegistration: Monaco.IDisposable | undefined;
  #selectionRegistration: Monaco.IDisposable | undefined;
  #selectionProvider: (Monaco.languages.SelectionRangeProvider & { dispose(): void }) | undefined;
  #boundDocument: BoundDocument | undefined;
  #startPromise: Promise<void> | undefined;
  #sessionNumber = 0;
  #disposed = false;

  constructor(monaco: typeof Monaco, options: SqlLabSyntaxRuntimeOptions = {}) {
    this.#monaco = monaco;
    this.#onError = options.onError;
  }

  start(): Promise<void> {
    if (this.#disposed) {
      return Promise.reject(new Error("SQL Lab syntax runtime is disposed."));
    }
    if (this.#startPromise !== undefined) {
      return this.#startPromise;
    }

    this.#supervisor = new WorkerSupervisor({
      createWorker: (workerGeneration) => {
        const worker = new Worker(
          new URL("../../../syntax/tree-sitter/worker/syntax.worker.ts", import.meta.url),
          { name: `sql-lab-syntax-${workerGeneration}`, type: "module" },
        );
        this.#worker = worker;
        worker.postMessage({ type: "initialize", workerGeneration });
        return worker;
      },
      getOpenDocumentSnapshots: () => {
        const bound = this.#boundDocument;
        return bound === undefined || bound.binding.state === "closed"
          ? []
          : [bound.binding.openDocumentSnapshot];
      },
      onWorkerReady: (worker, workerGeneration) => {
        this.#client?.replaceWorker(worker, workerGeneration);
      },
      restoreOpenDocuments: async () => {
        await this.#boundDocument?.binding.restore();
      },
    });

    this.#startPromise = this.#supervisor
      .start()
      .then(() => {
        if (this.#disposed || this.#supervisor === undefined) {
          return;
        }
        const worker = this.#getActiveWorker();
        if (worker === undefined) {
          throw new Error("SQL Lab syntax worker did not become available.");
        }
        this.#client = new TreeSitterClient(worker, this.#supervisor.workerGeneration);
        this.#selectionProvider = createSelectionRangeProvider(this.#registry);
        this.#semanticRegistration = registerSemanticHighlightProvider(
          this.#monaco,
          "sql",
          this.#registry,
        );
        this.#foldingRegistration = registerFoldingRangeProvider(
          this.#monaco,
          "sql",
          this.#registry,
        );
        this.#selectionRegistration = registerSelectionRangeProvider(
          this.#monaco,
          "sql",
          this.#registry,
        );
      })
      .catch((error: unknown) => {
        this.#startPromise = undefined;
        throw error;
      });
    return this.#startPromise;
  }

  bind(model: Monaco.editor.ITextModel): WorkspaceSyntaxBinding {
    if (this.#disposed || this.#client === undefined) {
      throw new Error("SQL Lab syntax runtime is not ready.");
    }
    this.#boundDocument?.dispose();

    const client = this.#client;
    const documentUri = model.uri.toString();
    const sessionId = `${SESSION_PREFIX}-${this.#sessionNumber}`;
    this.#sessionNumber += 1;
    const capabilityClient: SyntaxDocumentClient = {
      request: (request: TreeSitterClientRequest) => client.request(request),
      send: (request: TreeSitterClientRequest) => client.send(request),
    };
    const highlights = new HighlightCoordinator({
      client: capabilityClient,
      sessionId,
      documentUri,
      getDocumentVersion: () => model.getVersionId(),
      onError: this.#onError,
    });
    const folding = new FoldingCoordinator({
      client: capabilityClient,
      sessionId,
      documentUri,
      getDocumentVersion: () => model.getVersionId(),
      onError: this.#onError,
    });
    const selection = new SelectionCoordinator({
      client: capabilityClient,
      sessionId,
      documentUri,
      getDocumentVersion: () => model.getVersionId(),
      onError: this.#onError,
    });
    const binding = new MonacoSyntaxDocumentBinding({
      model,
      client,
      createSessionId: () => sessionId,
      onError: this.#onError,
      onParseResult: (result) => {
        highlights.requestLatest(result.documentVersion);
        folding.requestLatest(result.documentVersion);
      },
    });
    const registration = this.#registry.register(documentUri, {
      highlight: highlights,
      folding,
      selection,
    });
    let disposed = false;
    const dispose = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (this.#boundDocument?.binding === binding) {
        this.#boundDocument = undefined;
      }
      registration.dispose();
      highlights.dispose();
      folding.dispose();
      selection.dispose();
      binding.dispose();
    };
    const boundDocument: BoundDocument = {
      model,
      binding,
      highlights,
      folding,
      selection,
      registration,
      dispose,
    };
    this.#boundDocument = boundDocument;
    return { dispose };
  }

  get selectionProvider(): Monaco.languages.SelectionRangeProvider | undefined {
    return this.#selectionProvider;
  }

  get registry(): DocumentSyntaxCapabilityRegistry {
    return this.#registry;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#boundDocument?.dispose();
    this.#boundDocument = undefined;
    this.#semanticRegistration?.dispose();
    this.#foldingRegistration?.dispose();
    this.#selectionRegistration?.dispose();
    this.#selectionProvider?.dispose();
    this.#client?.dispose();
    this.#supervisor?.terminate();
    this.#semanticRegistration = undefined;
    this.#foldingRegistration = undefined;
    this.#selectionRegistration = undefined;
    this.#selectionProvider = undefined;
    this.#client = undefined;
    this.#supervisor = undefined;
  }

  #getActiveWorker(): Worker | undefined {
    return this.#worker;
  }
}

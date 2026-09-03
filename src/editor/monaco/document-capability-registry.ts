import type { FoldingCoordinator } from "./folding-provider";
import type { HighlightCoordinator } from "./highlight-coordinator";
import type { SelectionCoordinator } from "./selection-provider";

export interface DocumentSyntaxCapabilities {
  highlight: HighlightCoordinator;
  folding: FoldingCoordinator;
  selection: SelectionCoordinator;
}

export interface DocumentSyntaxCapabilityDisposable {
  dispose(): void;
}

type RegistryListener = (uri: string, capabilities: DocumentSyntaxCapabilities | undefined) => void;

export class DocumentSyntaxCapabilityRegistry {
  private readonly entries = new Map<string, DocumentSyntaxCapabilities>();
  private readonly listeners = new Set<RegistryListener>();

  register(
    uri: string,
    capabilities: DocumentSyntaxCapabilities,
  ): DocumentSyntaxCapabilityDisposable {
    this.entries.set(uri, capabilities);
    this.notify(uri, capabilities);

    return {
      dispose: () => {
        if (this.entries.get(uri) !== capabilities) {
          return;
        }
        this.entries.delete(uri);
        this.notify(uri, undefined);
      },
    };
  }

  get(uri: string): DocumentSyntaxCapabilities | undefined {
    return this.entries.get(uri);
  }

  onDidChange(listener: RegistryListener): DocumentSyntaxCapabilityDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  forEach(listener: RegistryListener): void {
    for (const [uri, capabilities] of this.entries) {
      listener(uri, capabilities);
    }
  }

  private notify(uri: string, capabilities: DocumentSyntaxCapabilities | undefined): void {
    for (const listener of this.listeners) {
      listener(uri, capabilities);
    }
  }
}

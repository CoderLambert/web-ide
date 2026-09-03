import {
  WORKSPACE_FILE_SYSTEM_ERROR_CODES,
  WorkspaceFileSystemError,
  type WorkspaceEntry,
  type WorkspaceFileSystem,
  type WorkspaceFileSystemErrorCode,
} from "./file-system";
import { validateWorkspacePath, type WorkspacePath } from "./path";
import { workspaceErrorMessage, type WorkspaceApiRequest } from "./remote-workspace-protocol";

export type WorkspaceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RemoteWorkspaceFileSystemOptions {
  endpoint?: string;
  fetch?: WorkspaceFetch;
}

export class RemoteWorkspaceFileSystem implements WorkspaceFileSystem {
  readonly #workspaceId: string;
  readonly #endpoint: string;
  readonly #fetch: WorkspaceFetch;

  constructor(workspaceId: string, options: RemoteWorkspaceFileSystemOptions = {}) {
    this.#workspaceId = workspaceId;
    this.#endpoint = options.endpoint ?? "/api/workspace";
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async list(path: WorkspacePath): Promise<WorkspaceEntry[]> {
    this.validatePath(path, true);
    const result = await this.request({ workspaceId: this.#workspaceId, operation: "list", path });
    if (!Array.isArray(result)) {
      throw invalidResponse();
    }
    return result.map(decodeWorkspaceEntry);
  }

  async readFile(path: WorkspacePath): Promise<string> {
    this.validatePath(path);
    const result = await this.request({
      workspaceId: this.#workspaceId,
      operation: "readFile",
      path,
    });
    if (typeof result !== "string") {
      throw invalidResponse();
    }
    return result;
  }

  async writeFile(path: WorkspacePath, content: string): Promise<void> {
    this.validatePath(path);
    await this.requestVoid({
      workspaceId: this.#workspaceId,
      operation: "writeFile",
      path,
      content,
    });
  }

  async createFile(path: WorkspacePath): Promise<void> {
    this.validatePath(path);
    await this.requestVoid({ workspaceId: this.#workspaceId, operation: "createFile", path });
  }

  async createDirectory(path: WorkspacePath): Promise<void> {
    this.validatePath(path);
    await this.requestVoid({
      workspaceId: this.#workspaceId,
      operation: "createDirectory",
      path,
    });
  }

  async rename(from: WorkspacePath, to: WorkspacePath): Promise<void> {
    this.validatePath(from);
    this.validatePath(to);
    await this.requestVoid({ workspaceId: this.#workspaceId, operation: "rename", from, to });
  }

  async delete(path: WorkspacePath): Promise<void> {
    this.validatePath(path);
    await this.requestVoid({ workspaceId: this.#workspaceId, operation: "delete", path });
  }

  private validatePath(path: string, allowRoot = false): void {
    try {
      validateWorkspacePath(path, { allowRoot });
    } catch {
      throw new WorkspaceFileSystemError("INVALID_PATH", "Invalid workspace path.");
    }
  }

  private async requestVoid(payload: WorkspaceApiRequest): Promise<void> {
    if ((await this.request(payload)) !== null) {
      throw invalidResponse();
    }
  }

  private async request(payload: WorkspaceApiRequest): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
    } catch {
      throw new WorkspaceFileSystemError("IO_ERROR", "Workspace request failed.");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidResponse();
    }

    if (!isRecord(body) || typeof body.ok !== "boolean") {
      throw invalidResponse();
    }
    if (!body.ok) {
      if (!hasExactKeys(body, ["ok", "error"])) {
        throw invalidResponse();
      }
      const error = body.error;
      if (
        !isRecord(error) ||
        !hasExactKeys(error, ["code", "message"]) ||
        typeof error.message !== "string" ||
        !isWorkspaceErrorCode(error.code)
      ) {
        throw invalidResponse();
      }
      throw new WorkspaceFileSystemError(error.code, workspaceErrorMessage(error.code));
    }
    if (!hasExactKeys(body, ["ok", "result"])) {
      throw invalidResponse();
    }
    return body.result;
  }
}

function decodeWorkspaceEntry(value: unknown): WorkspaceEntry {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["path", "kind"]) ||
    (value.kind !== "file" && value.kind !== "directory")
  ) {
    throw invalidResponse();
  }
  if (typeof value.path !== "string") {
    throw invalidResponse();
  }
  try {
    validateWorkspacePath(value.path);
  } catch {
    throw invalidResponse();
  }
  return { path: value.path, kind: value.kind };
}

function isWorkspaceErrorCode(value: unknown): value is WorkspaceFileSystemErrorCode {
  return (
    typeof value === "string" &&
    WORKSPACE_FILE_SYSTEM_ERROR_CODES.includes(value as WorkspaceFileSystemErrorCode)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function invalidResponse(): WorkspaceFileSystemError {
  return new WorkspaceFileSystemError("IO_ERROR", "Workspace API returned an invalid response.");
}

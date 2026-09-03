import {
  WorkspaceFileSystemError,
  type WorkspaceFileSystem,
  type WorkspaceFileSystemErrorCode,
} from "../../workspace/file-system";
import { validateWorkspacePath, type WorkspacePath } from "../../workspace/path";
import type {
  WorkspaceApiRequest,
  WorkspaceApiResponse,
  WorkspaceApiResult,
} from "../../workspace/remote-workspace-protocol";
import { workspaceErrorMessage } from "../../workspace/remote-workspace-protocol";
import type {
  WorkspaceAuthorizer,
  WorkspaceRootResolver,
} from "./authorized-workspace-file-system";
import { createAuthorizedWorkspaceFileSystem } from "./authorized-workspace-file-system";

export interface WorkspaceApiDependencies {
  authorizer: WorkspaceAuthorizer;
  rootResolver: WorkspaceRootResolver;
}

export async function handleWorkspaceApiRequest(
  request: Request,
  dependencies: WorkspaceApiDependencies,
): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return failureResponse("UNSUPPORTED", "Unsupported workspace request.", 405);
    }

    const payload = decodeRequest(await readJson(request));
    const fileSystem = await createAuthorizedWorkspaceFileSystem(
      payload.workspaceId,
      dependencies.authorizer,
      dependencies.rootResolver,
    );
    const result = await execute(fileSystem, payload);
    const response: WorkspaceApiResponse = { ok: true, result };
    return Response.json(response);
  } catch (error) {
    if (error instanceof WorkspaceFileSystemError) {
      return failureResponse(error.code, workspaceErrorMessage(error.code), statusFor(error.code));
    }
    return failureResponse("IO_ERROR", "Workspace request failed.", 500);
  }
}

async function execute(
  fileSystem: WorkspaceFileSystem,
  request: WorkspaceApiRequest,
): Promise<WorkspaceApiResult> {
  switch (request.operation) {
    case "list":
      return fileSystem.list(request.path);
    case "readFile":
      return fileSystem.readFile(request.path);
    case "writeFile":
      await fileSystem.writeFile(request.path, request.content);
      return null;
    case "createFile":
      await fileSystem.createFile(request.path);
      return null;
    case "createDirectory":
      await fileSystem.createDirectory(request.path);
      return null;
    case "rename":
      await fileSystem.rename(request.from, request.to);
      return null;
    case "delete":
      await fileSystem.delete(request.path);
      return null;
  }
}

function decodeRequest(input: unknown): WorkspaceApiRequest {
  if (!isRecord(input) || typeof input.workspaceId !== "string" || input.workspaceId === "") {
    throw new WorkspaceFileSystemError("FORBIDDEN", "Workspace access denied.");
  }
  if (typeof input.operation !== "string") {
    throw new WorkspaceFileSystemError("UNSUPPORTED", "Unsupported workspace request.");
  }

  const workspaceId = input.workspaceId;
  switch (input.operation) {
    case "list":
      exactKeys(input, ["workspaceId", "operation", "path"]);
      return { workspaceId, operation: "list", path: readPath(input.path, true) };
    case "readFile":
    case "createFile":
    case "createDirectory":
    case "delete":
      exactKeys(input, ["workspaceId", "operation", "path"]);
      return { workspaceId, operation: input.operation, path: readPath(input.path) };
    case "writeFile":
      exactKeys(input, ["workspaceId", "operation", "path", "content"]);
      if (typeof input.content !== "string") {
        throw new WorkspaceFileSystemError("UNSUPPORTED", "Unsupported workspace request.");
      }
      return {
        workspaceId,
        operation: "writeFile",
        path: readPath(input.path),
        content: input.content,
      };
    case "rename":
      exactKeys(input, ["workspaceId", "operation", "from", "to"]);
      return {
        workspaceId,
        operation: "rename",
        from: readPath(input.from),
        to: readPath(input.to),
      };
    default:
      throw new WorkspaceFileSystemError("UNSUPPORTED", "Unsupported workspace request.");
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new WorkspaceFileSystemError("UNSUPPORTED", "Unsupported workspace request.");
  }
}

function readPath(value: unknown, allowRoot = false): WorkspacePath {
  if (typeof value !== "string") {
    throw new WorkspaceFileSystemError("INVALID_PATH", "Invalid workspace path.");
  }
  try {
    return validateWorkspacePath(value, { allowRoot });
  } catch {
    throw new WorkspaceFileSystemError("INVALID_PATH", "Invalid workspace path.");
  }
}

function exactKeys(record: Record<string, unknown>, expected: string[]): void {
  const keys = Object.keys(record);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new WorkspaceFileSystemError("UNSUPPORTED", "Unsupported workspace request.");
  }
}

function failureResponse(
  code: WorkspaceFileSystemErrorCode,
  message: string,
  status: number,
): Response {
  const response: WorkspaceApiResponse = { ok: false, error: { code, message } };
  return Response.json(response, { status });
}

function statusFor(code: WorkspaceFileSystemErrorCode): number {
  switch (code) {
    case "INVALID_PATH":
      return 400;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "ALREADY_EXISTS":
    case "DIRECTORY_NOT_EMPTY":
      return 409;
    case "NOT_FILE":
    case "NOT_DIRECTORY":
    case "UNSUPPORTED":
      return 422;
    case "IO_ERROR":
      return 500;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

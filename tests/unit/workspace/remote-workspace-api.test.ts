import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  handleWorkspaceApiRequest,
  type WorkspaceApiDependencies,
} from "../../../src/server/workspace/api";
import { handleWorkspaceApiRequestWithConfiguration } from "../../../src/server/workspace/api.server";
import { WorkspaceFileSystemError } from "../../../src/workspace/file-system";
import {
  RemoteWorkspaceFileSystem,
  type WorkspaceFetch,
} from "../../../src/workspace/remote-workspace-file-system";
import {
  encodedTraversalTransportPaths,
  invalidWorkspacePaths,
} from "../../fixtures/workspace-paths";

const workspaceId = "workspace-1";
let workspaceRoot: string;
let outsideRoot: string;
let authorizationCalls: string[];
let rootResolutionCalls: string[];
let dependencies: WorkspaceApiDependencies;
let capturedRequests: Request[];
let remote: RemoteWorkspaceFileSystem;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "web-ide-w04-workspace-"));
  outsideRoot = await mkdtemp(join(tmpdir(), "web-ide-w04-outside-"));
  authorizationCalls = [];
  rootResolutionCalls = [];
  dependencies = {
    authorizer: {
      async authorize(requestedWorkspaceId) {
        authorizationCalls.push(requestedWorkspaceId);
        if (requestedWorkspaceId !== workspaceId) {
          throw new WorkspaceFileSystemError("FORBIDDEN", "Workspace access denied.");
        }
      },
    },
    rootResolver: {
      async resolveRoot(requestedWorkspaceId) {
        rootResolutionCalls.push(requestedWorkspaceId);
        return workspaceRoot;
      },
    },
  };
  capturedRequests = [];
  remote = new RemoteWorkspaceFileSystem(workspaceId, { fetch: createApiFetch() });
});

afterEach(async () => {
  await Promise.all([
    rm(workspaceRoot, { recursive: true, force: true }),
    rm(outsideRoot, { recursive: true, force: true }),
  ]);
});

describe("Workspace API and RemoteWorkspaceFileSystem", () => {
  it("persists the complete workspace contract through structured requests", async () => {
    await mkdir(join(workspaceRoot, "src"));
    await writeFile(join(workspaceRoot, "src", "main.ts"), "initial", "utf8");

    await expect(remote.list("")).resolves.toEqual([{ path: "src", kind: "directory" }]);
    await expect(remote.list("src")).resolves.toEqual([{ path: "src/main.ts", kind: "file" }]);
    await expect(remote.readFile("src/main.ts")).resolves.toBe("initial");

    await remote.writeFile("src/main.ts", "persisted");
    expect(await readFile(join(workspaceRoot, "src", "main.ts"), "utf8")).toBe("persisted");
    await remote.createFile("src/new.txt");
    await remote.createDirectory("src/new-directory");
    await remote.rename("src/new.txt", "src/renamed.txt");
    await remote.delete("src/renamed.txt");
    await remote.delete("src/new-directory");

    expect(await readdir(join(workspaceRoot, "src"))).toEqual(["main.ts"]);
    expect(capturedRequests).toHaveLength(9);
    for (const request of capturedRequests) {
      expect(new URL(request.url).pathname).toBe("/api/workspace");
      expect(request.method).toBe("POST");
    }
    expect(await capturedRequests[1]!.clone().json()).toEqual({
      workspaceId,
      operation: "list",
      path: "src",
    });
  });

  it("binds each Remote instance to one workspace identity", async () => {
    const denied = new RemoteWorkspaceFileSystem("workspace-2", { fetch: createApiFetch() });

    await expectCode(() => denied.list(""), "FORBIDDEN");
    expect(authorizationCalls).toEqual(["workspace-2"]);
    expect(rootResolutionCalls).toEqual([]);
  });

  it("uses ambient same-origin cookie authorization with the configured route", async () => {
    const configuration = { workspaceId, root: workspaceRoot, token: "session-secret" };
    const configuredFetch: WorkspaceFetch = async (input, init) => {
      expect(init?.credentials).toBe("same-origin");
      const headers = new Headers(init?.headers);
      headers.set("cookie", "other=value; web_ide_workspace_token=session-secret");
      const url = typeof input === "string" ? new URL(input, "http://workspace.test") : input;
      return handleWorkspaceApiRequestWithConfiguration(
        new Request(url, { ...init, headers }),
        configuration,
      );
    };
    const configuredRemote = new RemoteWorkspaceFileSystem(workspaceId, {
      fetch: configuredFetch,
    });

    await expect(configuredRemote.list("")).resolves.toEqual([]);

    const noCredential = await handleWorkspaceApiRequestWithConfiguration(
      new Request("http://workspace.test/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, operation: "list", path: "" }),
      }),
      configuration,
    );
    expect(noCredential.status).toBe(403);
    await expect(noCredential.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("validates paths in the browser and independently at the API boundary", async () => {
    let fetchCalls = 0;
    const validatingRemote = new RemoteWorkspaceFileSystem(workspaceId, {
      fetch: async () => {
        fetchCalls += 1;
        throw new Error("must not fetch");
      },
    });

    for (const path of invalidWorkspacePaths) {
      await expectCode(() => validatingRemote.readFile(path), "INVALID_PATH");
    }
    expect(fetchCalls).toBe(0);

    for (const encodedPath of encodedTraversalTransportPaths) {
      const response = await post({
        workspaceId,
        operation: "readFile",
        path: decodeURIComponent(encodedPath),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_PATH" },
      });
    }
    expect(rootResolutionCalls).toEqual([]);
  });

  it("does not decode percent-like JSON paths or permit escape", async () => {
    const outsideFile = join(outsideRoot, "secret.ts");
    await writeFile(outsideFile, "outside", "utf8");

    await expectCode(() => remote.readFile("%2e%2e/secret.ts"), "NOT_FOUND");

    expect(await readFile(outsideFile, "utf8")).toBe("outside");
    expect(await readdir(workspaceRoot)).toEqual([]);
    expect(await capturedRequests[0]!.clone().json()).toMatchObject({
      path: "%2e%2e/secret.ts",
    });
  });

  it("keeps Backend symlink containment effective through the API", async () => {
    const outsideFile = join(outsideRoot, "secret.txt");
    await writeFile(outsideFile, "outside", "utf8");
    await symlink(outsideFile, join(workspaceRoot, "link.txt"));

    await expectCode(() => remote.readFile("link.txt"), "UNSUPPORTED");
    await expectCode(() => remote.writeFile("link.txt", "changed"), "UNSUPPORTED");
    await expectCode(() => remote.delete("link.txt"), "UNSUPPORTED");
    await expect(remote.list("")).resolves.toEqual([]);
    expect(await readFile(outsideFile, "utf8")).toBe("outside");
  });

  it("rejects client-supplied host-root fields before filesystem creation", async () => {
    const response = await post({
      workspaceId,
      operation: "list",
      path: "",
      root: outsideRoot,
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: { code: "UNSUPPORTED", message: "Unsupported workspace request." },
    });
    expect(JSON.stringify(body)).not.toContain(outsideRoot);
    expect(authorizationCalls).toEqual([]);
    expect(rootResolutionCalls).toEqual([]);
  });

  it("normalizes Backend, authorization, resolver, and malformed-request errors", async () => {
    await expectCode(() => remote.readFile("missing.txt"), "NOT_FOUND");

    dependencies.authorizer.authorize = async () => {
      throw new WorkspaceFileSystemError("FORBIDDEN", `authorization detail: ${outsideRoot}`);
    };
    const authorizationFailure = await post({ workspaceId, operation: "list", path: "" });
    const authorizationBody = await authorizationFailure.json();
    expect(authorizationBody).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Workspace access denied." },
    });
    expect(JSON.stringify(authorizationBody)).not.toContain(outsideRoot);

    dependencies.authorizer.authorize = async () => undefined;
    dependencies.rootResolver.resolveRoot = async () => {
      throw new WorkspaceFileSystemError("IO_ERROR", `resolver detail: ${outsideRoot}`);
    };
    const resolverFailure = await post({ workspaceId, operation: "list", path: "" });
    const resolverBody = await resolverFailure.json();
    expect(resolverBody).toEqual({
      ok: false,
      error: { code: "IO_ERROR", message: "Workspace operation failed." },
    });
    expect(JSON.stringify(resolverBody)).not.toContain(outsideRoot);

    const malformed = await handleWorkspaceApiRequest(
      new Request("http://workspace.test/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
      dependencies,
    );
    expect(malformed.status).toBe(422);
    await expect(malformed.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED" },
    });
  });

  it("maps fetch and invalid response failures without exposing transport details", async () => {
    const unavailable = new RemoteWorkspaceFileSystem(workspaceId, {
      fetch: async () => {
        throw new Error("network secret");
      },
    });
    await expectCode(() => unavailable.list(""), "IO_ERROR");

    const invalid = new RemoteWorkspaceFileSystem(workspaceId, {
      fetch: async () => Response.json({ ok: true, result: { hostPath: outsideRoot } }),
    });
    await expectCode(() => invalid.list(""), "IO_ERROR");

    const leakingEntry = new RemoteWorkspaceFileSystem(workspaceId, {
      fetch: async () =>
        Response.json({
          ok: true,
          result: [{ path: "safe.txt", kind: "file", hostPath: outsideRoot }],
        }),
    });
    await expectCode(() => leakingEntry.list(""), "IO_ERROR");

    const leakingError = new RemoteWorkspaceFileSystem(workspaceId, {
      fetch: async () =>
        Response.json({
          ok: false,
          error: { code: "NOT_FOUND", message: `host path: ${outsideRoot}` },
        }),
    });
    let caught: unknown;
    try {
      await leakingError.readFile("missing.txt");
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "NOT_FOUND",
      message: "Workspace entry was not found.",
    });
    expect(String(caught)).not.toContain(outsideRoot);
  });
});

function createApiFetch(): WorkspaceFetch {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? new URL(input, "http://workspace.test")
        : input instanceof URL
          ? input
          : input.url;
    const request = new Request(url, init);
    capturedRequests.push(request.clone());
    return handleWorkspaceApiRequest(request, dependencies);
  };
}

function post(body: unknown): Promise<Response> {
  return handleWorkspaceApiRequest(
    new Request("http://workspace.test/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    dependencies,
  );
}

async function expectCode(operation: () => Promise<unknown>, code: string): Promise<void> {
  await expect(operation()).rejects.toMatchObject({ code });
}

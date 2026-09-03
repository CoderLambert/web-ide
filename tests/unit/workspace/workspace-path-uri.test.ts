import { describe, expect, it } from "vite-plus/test";

import {
  encodedTraversalTransportPaths,
  invalidWorkspacePaths,
  invalidWorkspaceUris,
  validWorkspacePaths,
} from "../../fixtures/workspace-paths";
import { WORKSPACE_ROOT_URI } from "../../../src/workspace/identity";
import { validateWorkspacePath } from "../../../src/workspace/path";
import {
  fromWorkspaceUri,
  toWorkspaceUri,
  workspaceUriMapper,
} from "../../../src/workspace/uri-mapper";

describe("WorkspacePath", () => {
  it("accepts canonical relative workspace paths", () => {
    for (const path of validWorkspacePaths) {
      expect(validateWorkspacePath(path)).toBe(path);
    }
  });

  it("allows the empty root path only when explicitly requested", () => {
    expect(() => validateWorkspacePath("")).toThrow();
    expect(validateWorkspacePath("", { allowRoot: true })).toBe("");
  });

  it("rejects non-canonical workspace paths without normalizing them", () => {
    for (const path of invalidWorkspacePaths) {
      expect(() => validateWorkspacePath(path)).toThrow();
    }
  });

  it("rejects traversal after transport decoding", () => {
    for (const encodedPath of encodedTraversalTransportPaths) {
      const decodedPath = decodeURIComponent(encodedPath);
      expect(() => validateWorkspacePath(decodedPath)).toThrow();
    }
  });
});

describe("WorkspaceUriMapper", () => {
  it("maps the frozen canonical URI example", () => {
    expect(workspaceUriMapper.toUri("src/main.ts")).toBe(
      "file:///workspace/src/main.ts",
    );
    expect(workspaceUriMapper.fromUri("file:///workspace/src/main.ts")).toBe(
      "src/main.ts",
    );
  });

  it("round-trips canonical paths without losing encoded characters", () => {
    const paths = [...validWorkspacePaths, "docs/hello world.md", "src/你好.ts"];

    for (const path of paths) {
      expect(fromWorkspaceUri(toWorkspaceUri(path))).toBe(path);
    }
  });

  it("round-trips the workspace root URI", () => {
    expect(toWorkspaceUri("")).toBe(WORKSPACE_ROOT_URI);
    expect(fromWorkspaceUri(WORKSPACE_ROOT_URI)).toBe("");
  });

  it("rejects non-canonical and escaping workspace URIs", () => {
    for (const uri of invalidWorkspaceUris) {
      expect(() => fromWorkspaceUri(uri)).toThrow();
    }
  });
});

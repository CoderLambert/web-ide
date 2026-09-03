export const validWorkspacePaths = ["src/main.ts", "src/lib/a.ts"] as const;

export const invalidWorkspacePaths = [
  "/a",
  "a/",
  "a//b",
  "./a",
  "a/../b",
  "a\\b",
  "a\0b",
] as const;

export const encodedTraversalTransportPaths = [
  "%2e%2e/secret.ts",
  "src/%2e%2e/secret.ts",
  "src/%2E%2E/secret.ts",
] as const;

export const invalidWorkspaceUris = [
  "file:///workspace/",
  "file:///workspace/src/%6dain.ts",
  "file:///workspace/src/../main.ts",
  "file:///workspace/src/%2e%2e/main.ts",
  "file:///workspace/src/a%2Fb.ts",
  "file:///workspace/src/main.ts?query=1",
  "file:///workspace/src/main.ts#fragment",
  "file://localhost/workspace/src/main.ts",
  "https://example.com/workspace/src/main.ts",
] as const;

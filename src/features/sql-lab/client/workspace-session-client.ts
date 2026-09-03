export interface WorkspaceSessionFetchOptions {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export async function bootstrapWorkspaceSession(
  options: WorkspaceSessionFetchOptions = {},
): Promise<void> {
  const fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetchImplementation("/api/workspace/session", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Workspace session bootstrap failed.");
  }

  if (!response.ok || response.status !== 204) {
    throw new Error("Workspace session bootstrap failed.");
  }
}

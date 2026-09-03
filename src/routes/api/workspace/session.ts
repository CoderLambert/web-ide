import { createFileRoute } from "@tanstack/react-router";

import { handleConfiguredWorkspaceSessionRequest } from "#/server/workspace/session.server";

export const Route = createFileRoute("/api/workspace/session")({
  server: {
    handlers: {
      POST: ({ request }) => handleConfiguredWorkspaceSessionRequest(request),
    },
  },
});

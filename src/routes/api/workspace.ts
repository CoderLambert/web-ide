import { createFileRoute } from "@tanstack/react-router";

import { handleConfiguredWorkspaceApiRequest } from "#/server/workspace/api.server";

export const Route = createFileRoute("/api/workspace")({
  server: {
    handlers: {
      POST: ({ request }) => handleConfiguredWorkspaceApiRequest(request),
    },
  },
});

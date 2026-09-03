import { createFileRoute } from "@tanstack/react-router";

import { handleConfiguredSqlLabApiRequest } from "#/server/sql-lab/config.server";

export const Route = createFileRoute("/api/sql-lab")({
  server: {
    handlers: {
      POST: ({ request }) => handleConfiguredSqlLabApiRequest(request),
    },
  },
});

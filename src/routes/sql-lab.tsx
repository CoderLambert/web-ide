import { createFileRoute } from "@tanstack/react-router";

import { SqlLabPage } from "#/features/sql-lab/sql-lab-page";

export const Route = createFileRoute("/sql-lab")({
  ssr: false,
  component: SqlLabPage,
});

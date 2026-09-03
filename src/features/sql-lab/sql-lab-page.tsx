import { SqlLabEditor } from "@/features/sql-lab/editor/sql-lab-editor";

const SQL_LAB_WORKSPACE_ID = import.meta.env.VITE_WEB_IDE_WORKSPACE_ID ?? "web-ide";

export function SqlLabPage() {
  return <SqlLabEditor workspaceId={SQL_LAB_WORKSPACE_ID} />;
}

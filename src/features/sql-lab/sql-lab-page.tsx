import { useRef, useState } from "react";

import type { SqlExecutionReport, SqlLabError } from "@/sql-lab/contract";
import { SqlLabClient, SqlLabClientError } from "@/features/sql-lab/client/sql-lab-client";
import { SqlLabEditor } from "@/features/sql-lab/editor/sql-lab-editor";
import type { SqlQuerySourceMode } from "@/features/sql-lab/query-source";
import { SqlResults } from "@/features/sql-lab/results/sql-results";

const SQL_LAB_WORKSPACE_ID = import.meta.env.VITE_WEB_IDE_WORKSPACE_ID ?? "web-ide";

export function SqlLabPage() {
  const clientRef = useRef<SqlLabClient | undefined>(undefined);
  const requestNumberRef = useRef(0);
  const [report, setReport] = useState<SqlExecutionReport>();
  const [error, setError] = useState<SqlLabError>();
  const [active, setActive] = useState(false);
  clientRef.current ??= new SqlLabClient({ workspaceId: SQL_LAB_WORKSPACE_ID });

  async function run(_mode: SqlQuerySourceMode, sql: string): Promise<void> {
    const client = clientRef.current;
    if (client === undefined) {
      return;
    }
    const requestNumber = requestNumberRef.current + 1;
    requestNumberRef.current = requestNumber;
    setActive(true);
    setError(undefined);
    try {
      const response = await client.execute(sql);
      if (requestNumber !== requestNumberRef.current) {
        return;
      }
      if (!response.ok) {
        setReport(undefined);
        setError(response.error);
        return;
      }
      if (response.value.operation !== "execute") {
        setReport(undefined);
        setError({ code: "INTERNAL_ERROR", message: "SQL Lab returned an unexpected result." });
        return;
      }
      setReport(response.value.execution);
    } catch (runError: unknown) {
      if (requestNumber === requestNumberRef.current) {
        setReport(undefined);
        setError({
          code: "INTERNAL_ERROR",
          message:
            runError instanceof SqlLabClientError ? runError.message : "SQL Lab request failed.",
        });
      }
    } finally {
      if (requestNumber === requestNumberRef.current) {
        setActive(false);
      }
    }
  }

  return (
    <main>
      <SqlLabEditor onRun={run} operationActive={active} workspaceId={SQL_LAB_WORKSPACE_ID} />
      <SqlResults error={error} loading={active} report={report} />
    </main>
  );
}

import { useEffect, useRef, useState } from "react";

import { SqlLabClient, SqlLabClientError } from "@/features/sql-lab/client/sql-lab-client";
import { bootstrapWorkspaceSession } from "@/features/sql-lab/client/workspace-session-client";
import { SqlLabEditor } from "@/features/sql-lab/editor/sql-lab-editor";
import type { SqlQuerySourceMode } from "@/features/sql-lab/query-source";
import { SqlResults } from "@/features/sql-lab/results/sql-results";
import { SchemaExplorer } from "@/features/sql-lab/schema/schema-explorer";
import type { SqlExecutionReport, SqlLabError, SqlSchema } from "@/sql-lab/contract";

const SQL_LAB_WORKSPACE_ID = import.meta.env.VITE_WEB_IDE_WORKSPACE_ID ?? "web-ide";

export function SqlLabPage() {
  const clientRef = useRef<SqlLabClient | undefined>(undefined);
  const requestNumberRef = useRef(0);
  const [report, setReport] = useState<SqlExecutionReport>();
  const [error, setError] = useState<SqlLabError>();
  const [schema, setSchema] = useState<SqlSchema>();
  const [schemaError, setSchemaError] = useState<SqlLabError>();
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [active, setActive] = useState(false);
  const [initializationState, setInitializationState] = useState<
    "bootstrapping" | "ready" | "error"
  >("bootstrapping");
  const [initializationError, setInitializationError] = useState("");
  clientRef.current ??= new SqlLabClient({ workspaceId: SQL_LAB_WORKSPACE_ID });

  useEffect(() => {
    let cancelled = false;
    void bootstrapWorkspaceSession()
      .then(() => refreshSchema())
      .then(() => {
        if (!cancelled) {
          setInitializationState("ready");
        }
      })
      .catch((bootstrapError: unknown) => {
        if (!cancelled) {
          setInitializationState("error");
          setInitializationError(
            bootstrapError instanceof Error
              ? bootstrapError.message
              : "Workspace session bootstrap failed.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshSchema(): Promise<void> {
    const client = clientRef.current;
    if (client === undefined) {
      return;
    }
    setSchemaLoading(true);
    try {
      const response = await client.schema();
      if (!response.ok) {
        setSchema(undefined);
        setSchemaError(response.error);
        return;
      }
      if (response.value.operation !== "schema") {
        setSchema(undefined);
        setSchemaError({
          code: "INTERNAL_ERROR",
          message: "SQL Lab returned an unexpected schema.",
        });
        return;
      }
      setSchema(response.value.schema);
      setSchemaError(undefined);
    } catch (schemaRequestError: unknown) {
      setSchema(undefined);
      setSchemaError({
        code: "INTERNAL_ERROR",
        message:
          schemaRequestError instanceof SqlLabClientError
            ? schemaRequestError.message
            : "SQL Lab schema request failed.",
      });
    } finally {
      setSchemaLoading(false);
    }
  }

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
        await refreshSchema();
        setActive(false);
      }
    }
  }

  async function explain(_mode: SqlQuerySourceMode, sql: string): Promise<void> {
    const client = clientRef.current;
    if (client === undefined) {
      return;
    }
    const requestNumber = requestNumberRef.current + 1;
    requestNumberRef.current = requestNumber;
    setActive(true);
    setError(undefined);
    try {
      const response = await client.explain(sql);
      if (requestNumber !== requestNumberRef.current) {
        return;
      }
      if (!response.ok) {
        setReport(undefined);
        setError(response.error);
        return;
      }
      if (response.value.operation !== "explain") {
        setReport(undefined);
        setError({
          code: "INTERNAL_ERROR",
          message: "SQL Lab returned an unexpected explain result.",
        });
        return;
      }
      setReport({
        status: "completed",
        results: [response.value.result],
        executionTimeMs: response.value.result.executionTimeMs,
        transactionRolledBack: false,
      });
    } catch (explainError: unknown) {
      if (requestNumber === requestNumberRef.current) {
        setReport(undefined);
        setError({
          code: "INTERNAL_ERROR",
          message:
            explainError instanceof SqlLabClientError
              ? explainError.message
              : "SQL Lab explain request failed.",
        });
      }
    } finally {
      if (requestNumber === requestNumberRef.current) {
        setActive(false);
      }
    }
  }

  async function reset(): Promise<void> {
    if (!window.confirm("Reset the SQL Lab demo database? This replaces its current contents.")) {
      return;
    }
    const client = clientRef.current;
    if (client === undefined) {
      return;
    }
    const requestNumber = requestNumberRef.current + 1;
    requestNumberRef.current = requestNumber;
    setActive(true);
    setError(undefined);
    try {
      const response = await client.reset();
      if (requestNumber !== requestNumberRef.current) {
        return;
      }
      if (!response.ok) {
        setError(response.error);
        return;
      }
      if (response.value.operation !== "reset") {
        setError({
          code: "INTERNAL_ERROR",
          message: "SQL Lab returned an unexpected reset result.",
        });
        return;
      }
      setSchema(response.value.schema);
      setSchemaError(undefined);
      setReport(undefined);
    } catch (resetError: unknown) {
      if (requestNumber === requestNumberRef.current) {
        setError({
          code: "INTERNAL_ERROR",
          message:
            resetError instanceof SqlLabClientError ? resetError.message : "SQL Lab reset failed.",
        });
      }
    } finally {
      if (requestNumber === requestNumberRef.current) {
        setActive(false);
      }
    }
  }

  if (initializationState === "bootstrapping") {
    return (
      <main data-testid="sql-lab-initialization">
        <p data-testid="sql-lab-state">bootstrapping</p>
      </main>
    );
  }

  if (initializationState === "error") {
    return (
      <main data-testid="sql-lab-initialization">
        <p data-testid="sql-lab-state">error</p>
        <p aria-live="polite" data-testid="sql-lab-session-error">
          {initializationError}
        </p>
      </main>
    );
  }

  return (
    <main>
      <SqlLabEditor
        onExplain={explain}
        onReset={reset}
        onRun={run}
        operationActive={active}
        workspaceId={SQL_LAB_WORKSPACE_ID}
      />
      <SqlResults error={error} loading={active} report={report} />
      <SchemaExplorer
        error={schemaError}
        loading={schemaLoading}
        onRefresh={() => void refreshSchema()}
        schema={schema}
      />
    </main>
  );
}

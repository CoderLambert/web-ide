import type { SqlExecutionReport, SqlLabError } from "@/sql-lab/contract";
import { SqlStatementResultView } from "@/features/sql-lab/results/result-view";

export interface SqlResultsProps {
  report?: SqlExecutionReport;
  error?: SqlLabError;
  loading?: boolean;
}

export function SqlResults({ report, error, loading = false }: SqlResultsProps) {
  return (
    <section data-testid="sql-lab-results" style={{ display: "grid", gap: 16 }}>
      <h2>Results</h2>
      {loading ? <p aria-live="polite">Executing SQL…</p> : null}
      {error !== undefined ? (
        <p aria-live="polite" style={{ color: "crimson" }}>
          {error.code}: {error.message}
        </p>
      ) : null}
      {report !== undefined ? (
        <>
          <small data-testid="sql-lab-execution-summary">
            {report.status} · {report.executionTimeMs.toFixed(1)} ms
            {report.transactionRolledBack ? " · transaction rolled back" : ""}
          </small>
          {report.results.map((result) => (
            <SqlStatementResultView key={result.statementIndex} result={result} />
          ))}
        </>
      ) : null}
      {report === undefined && error === undefined && !loading ? <p>No results yet.</p> : null}
    </section>
  );
}

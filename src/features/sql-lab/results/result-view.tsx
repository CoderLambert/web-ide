import type {
  ChangeStatementResult,
  ErrorStatementResult,
  QueryStatementResult,
  SqlStatementResult,
} from "@/sql-lab/contract";
import { SqlValueView } from "@/features/sql-lab/results/sql-value";

export function SqlStatementResultView({ result }: { result: SqlStatementResult }) {
  return (
    <section
      data-result-kind={result.kind}
      data-statement-index={result.statementIndex}
      style={{ display: "grid", gap: 8 }}
    >
      <strong>
        Statement {result.statementIndex + 1}: {result.statementPreview || "(empty)"}
      </strong>
      {result.kind === "query" ? <QueryResultView result={result} /> : null}
      {result.kind === "change" ? <ChangeResultView result={result} /> : null}
      {result.kind === "error" ? <ErrorResultView result={result} /> : null}
    </section>
  );
}

function QueryResultView({ result }: { result: QueryStatementResult }) {
  return (
    <>
      <div style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              {result.columns.map((column, columnIndex) => (
                <th key={`${column.name}-${columnIndex}`} scope="col">
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((value, columnIndex) => (
                  <td key={columnIndex} style={{ whiteSpace: "pre-wrap" }}>
                    <SqlValueView value={value} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>
        {result.returnedRowCount} rows · {result.executionTimeMs.toFixed(1)} ms
        {result.truncated ? ` · truncated (${result.truncationReason ?? "limit"})` : ""}
      </small>
    </>
  );
}

function ChangeResultView({ result }: { result: ChangeStatementResult }) {
  return (
    <small>
      {result.affectedRows} rows affected · {result.executionTimeMs.toFixed(1)} ms
    </small>
  );
}

function ErrorResultView({ result }: { result: ErrorStatementResult }) {
  return (
    <p aria-live="polite" style={{ color: "crimson" }}>
      {result.code}: {result.message} · {result.executionTimeMs.toFixed(1)} ms
    </p>
  );
}

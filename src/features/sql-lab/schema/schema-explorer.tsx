import type { SqlLabError, SqlSchema } from "@/sql-lab/contract";

export interface SchemaExplorerProps {
  schema?: SqlSchema;
  error?: SqlLabError;
  loading?: boolean;
  onRefresh?: () => void;
}

export function SchemaExplorer({ schema, error, loading = false, onRefresh }: SchemaExplorerProps) {
  return (
    <aside data-testid="sql-lab-schema" style={{ display: "grid", gap: 8 }}>
      <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
        <h2>Schema</h2>
        <button disabled={loading} onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>
      {error !== undefined ? (
        <p>
          {error.code}: {error.message}
        </p>
      ) : null}
      {schema?.tables.map((table) => (
        <details key={table.name} open>
          <summary>{table.name}</summary>
          <ul>
            {table.columns.map((column) => (
              <li key={column.name}>
                {column.name} · {column.declaredType ?? "(no type)"}
                {column.nullable ? "" : " · NOT NULL"}
                {column.primaryKeyPosition > 0 ? " · PK" : ""}
              </li>
            ))}
          </ul>
          {table.indexes.length > 0 ? (
            <ul>
              {table.indexes.map((index) => (
                <li key={index.name}>
                  {index.name} ({index.columns.join(", ")}){index.unique ? " · UNIQUE" : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ))}
      {schema !== undefined && schema.tables.length === 0 ? <p>No tables.</p> : null}
    </aside>
  );
}

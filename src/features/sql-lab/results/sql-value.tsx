import type { SqlValue } from "@/sql-lab/contract";

export function formatSqlValue(value: SqlValue): string {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  switch (value.kind) {
    case "integer64":
      return value.value;
    case "blob":
      return `BLOB (${value.byteLength} bytes)`;
    case "text":
      return `${value.value} … [truncated; ${value.originalByteLength} bytes]`;
  }
}

export function SqlValueView({ value }: { value: SqlValue }) {
  const isNull = value === null;
  return (
    <span
      data-sql-value-kind={isNull ? "null" : typeof value === "object" ? value.kind : typeof value}
    >
      {formatSqlValue(value)}
    </span>
  );
}

import { describe, expect, it } from "vite-plus/test";

import { formatSqlValue } from "@/features/sql-lab/results/sql-value";

describe("SQL Lab results", () => {
  it("keeps null, int64, blob, and truncation visible", () => {
    expect(formatSqlValue(null)).toBe("NULL");
    expect(formatSqlValue({ kind: "integer64", value: "9223372036854775807" })).toBe(
      "9223372036854775807",
    );
    expect(formatSqlValue({ kind: "blob", byteLength: 8 })).toBe("BLOB (8 bytes)");
    expect(
      formatSqlValue({
        kind: "text",
        value: "long",
        originalByteLength: 70_000,
        truncated: true,
      }),
    ).toContain("truncated");
  });
});

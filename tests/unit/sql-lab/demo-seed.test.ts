import { describe, expect, it } from "vite-plus/test";

import { DEMO_SEED_SQL, DEMO_SEED_VERSION, DEMO_TABLE_NAMES } from "@/sql-lab/demo-seed";

describe("SQL Lab demo seed", () => {
  it("is a deterministic relational fixture", () => {
    expect(DEMO_SEED_VERSION).toBe("sql-lab-demo-v1");
    expect(DEMO_TABLE_NAMES).toEqual(["customers", "products", "orders", "order_items"]);
    expect(DEMO_SEED_SQL).toContain("REFERENCES customers(id)");
    expect(DEMO_SEED_SQL).toContain("REFERENCES products(id)");
    expect(DEMO_SEED_SQL).toContain("UNIQUE (order_id, product_id)");
    expect(DEMO_SEED_SQL).toContain("CHECK (quantity > 0)");
  });

  it("contains enough data for joins, grouping, filtering, and explain", () => {
    expect(DEMO_SEED_SQL.match(/INSERT INTO customers/g)).toHaveLength(1);
    expect(DEMO_SEED_SQL.match(/INSERT INTO products/g)).toHaveLength(1);
    expect(DEMO_SEED_SQL.match(/INSERT INTO orders/g)).toHaveLength(1);
    expect(DEMO_SEED_SQL.match(/INSERT INTO order_items/g)).toHaveLength(1);
    expect((DEMO_SEED_SQL.match(/\),/g) ?? []).length).toBeGreaterThanOrEqual(20);
  });

  it("does not rely on an external database or executable", () => {
    expect(DEMO_SEED_SQL).not.toMatch(/ATTACH|load_extension|VACUUM INTO/i);
    expect(DEMO_SEED_SQL).toContain("PRAGMA foreign_keys = ON");
  });
});

export const DEMO_SEED_VERSION = "sql-lab-demo-v1";

export const DEMO_SEED_SQL = `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
  total_amount REAL NOT NULL CHECK (total_amount >= 0)
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  UNIQUE (order_id, product_id)
);

CREATE INDEX idx_customers_region ON customers(region);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_orders_customer_date ON orders(customer_id, order_date);
CREATE INDEX idx_order_items_product ON order_items(product_id);

INSERT INTO customers (id, email, name, region, created_at) VALUES
  (1, 'alice@example.com', 'Alice Chen', 'East', '2025-01-10'),
  (2, 'bruno@example.com', 'Bruno Silva', 'West', '2025-01-12'),
  (3, 'chloe@example.com', 'Chloe Martin', 'North', '2025-01-15'),
  (4, 'diego@example.com', 'Diego Rossi', 'East', '2025-01-20');

INSERT INTO products (id, sku, name, category, price, stock, active) VALUES
  (1, 'KB-001', 'Mechanical Keyboard', 'Peripherals', 89.00, 42, 1),
  (2, 'MS-002', 'Ergonomic Mouse', 'Peripherals', 49.50, 76, 1),
  (3, 'MN-003', '27-inch Monitor', 'Displays', 279.99, 18, 1),
  (4, 'HB-004', 'USB-C Hub', 'Accessories', 39.95, 55, 1),
  (5, 'DS-005', 'Desk Stand', 'Accessories', 64.00, 0, 0);

INSERT INTO orders (id, customer_id, order_date, status, total_amount) VALUES
  (1001, 1, '2025-02-01', 'paid', 138.50),
  (1002, 1, '2025-02-08', 'shipped', 279.99),
  (1003, 2, '2025-02-10', 'paid', 104.00),
  (1004, 3, '2025-02-14', 'pending', 319.94),
  (1005, 4, '2025-02-18', 'cancelled', 64.00),
  (1006, 2, '2025-02-20', 'shipped', 89.00);

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
  (1001, 1, 1, 89.00),
  (1001, 2, 1, 49.50),
  (1002, 3, 1, 279.99),
  (1003, 2, 1, 49.50),
  (1003, 4, 1, 39.95),
  (1004, 3, 1, 279.99),
  (1004, 4, 1, 39.95),
  (1006, 1, 1, 89.00);
`;

export const DEMO_TABLE_NAMES = ["customers", "products", "orders", "order_items"] as const;

export type DemoTableName = (typeof DEMO_TABLE_NAMES)[number];

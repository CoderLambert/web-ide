-- ============================================================
-- SQL Test Dataset
-- Dialect: SQLite
-- Purpose: SQL editor / parser / executor / syntax highlight testing
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- 1. Drop old tables
-- ------------------------------------------------------------
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;

-- ------------------------------------------------------------
-- 2. Create tables
-- ------------------------------------------------------------
CREATE TABLE users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE,
    email       TEXT NOT NULL UNIQUE,
    age         INTEGER CHECK (age >= 0),
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    price       DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
    stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    order_no    TEXT NOT NULL UNIQUE,
    total       DECIMAL(10, 2) NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE order_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    INTEGER NOT NULL,
    product_id  INTEGER NOT NULL,
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    unit_price  DECIMAL(10, 2) NOT NULL CHECK (unit_price >= 0),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- ------------------------------------------------------------
-- 3. Insert test data
-- ------------------------------------------------------------
INSERT INTO users (username, email, age, status) VALUES
('alice',   'alice@example.com',   26, 'active'),
('bob',     'bob@example.com',     31, 'active'),
('charlie', 'charlie@example.com', 22, 'inactive'),
('diana',   'diana@example.com',   35, 'active'),
('eric',    'eric@example.com',    29, 'active');

INSERT INTO products (name, category, price, stock) VALUES
('Mechanical Keyboard', 'Electronics', 89.90, 25),
('Wireless Mouse',      'Electronics', 39.50, 50),
('USB-C Hub',           'Electronics', 59.00, 18),
('Notebook',            'Stationery',   6.80, 100),
('Gel Pen',             'Stationery',   2.50, 200),
('Coffee Mug',          'Home',        12.90, 40);

INSERT INTO orders (user_id, order_no, total, status, created_at) VALUES
(1, 'ORD-2026-0001', 129.40, 'paid',      '2026-09-01 09:30:00'),
(2, 'ORD-2026-0002',  59.00, 'shipped',   '2026-09-01 11:10:00'),
(1, 'ORD-2026-0003',  18.60, 'completed', '2026-09-02 15:45:00'),
(4, 'ORD-2026-0004', 102.80, 'pending',   '2026-09-03 08:20:00');

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
(1, 1, 1, 89.90),
(1, 2, 1, 39.50),
(2, 3, 1, 59.00),
(3, 4, 2,  6.80),
(3, 5, 2,  2.50),
(4, 2, 2, 39.50),
(4, 6, 1, 12.90),
(4, 4, 1,  6.80),
(4, 5, 2,  2.50);

-- ------------------------------------------------------------
-- 4. Basic SELECT
-- ------------------------------------------------------------
SELECT * FROM users;

SELECT
    id,
    username,
    email,
    age
FROM users
WHERE status = 'active'
ORDER BY age DESC;

-- ------------------------------------------------------------
-- 5. WHERE / LIKE / IN / BETWEEN
-- ------------------------------------------------------------
SELECT *
FROM products
WHERE price BETWEEN 10 AND 100
  AND category IN ('Electronics', 'Home')
  AND name LIKE '%o%'
ORDER BY price DESC;

-- ------------------------------------------------------------
-- 6. JOIN
-- ------------------------------------------------------------
SELECT
    o.order_no,
    u.username,
    o.total,
    o.status,
    o.created_at
FROM orders AS o
INNER JOIN users AS u
    ON u.id = o.user_id
ORDER BY o.created_at DESC;

-- ------------------------------------------------------------
-- 7. Multi-table JOIN
-- ------------------------------------------------------------
SELECT
    o.order_no,
    u.username,
    p.name AS product_name,
    oi.quantity,
    oi.unit_price,
    oi.quantity * oi.unit_price AS subtotal
FROM order_items AS oi
JOIN orders AS o
    ON o.id = oi.order_id
JOIN users AS u
    ON u.id = o.user_id
JOIN products AS p
    ON p.id = oi.product_id
ORDER BY o.id, oi.id;

-- ------------------------------------------------------------
-- 8. GROUP BY / HAVING / aggregate functions
-- ------------------------------------------------------------
SELECT
    u.username,
    COUNT(o.id) AS order_count,
    COALESCE(SUM(o.total), 0) AS total_spent,
    ROUND(AVG(o.total), 2) AS avg_order_amount
FROM users AS u
LEFT JOIN orders AS o
    ON o.user_id = u.id
GROUP BY u.id, u.username
HAVING COUNT(o.id) >= 1
ORDER BY total_spent DESC;

-- ------------------------------------------------------------
-- 9. Subquery
-- ------------------------------------------------------------
SELECT
    name,
    price
FROM products
WHERE price > (
    SELECT AVG(price)
    FROM products
)
ORDER BY price DESC;

-- ------------------------------------------------------------
-- 10. CASE expression
-- ------------------------------------------------------------
SELECT
    name,
    price,
    CASE
        WHEN price >= 80 THEN 'expensive'
        WHEN price >= 30 THEN 'medium'
        ELSE 'cheap'
    END AS price_level
FROM products
ORDER BY price DESC;

-- ------------------------------------------------------------
-- 11. CTE
-- ------------------------------------------------------------
WITH user_order_stats AS (
    SELECT
        user_id,
        COUNT(*) AS order_count,
        SUM(total) AS total_spent
    FROM orders
    GROUP BY user_id
)
SELECT
    u.username,
    COALESCE(s.order_count, 0) AS order_count,
    COALESCE(s.total_spent, 0) AS total_spent
FROM users AS u
LEFT JOIN user_order_stats AS s
    ON s.user_id = u.id
ORDER BY total_spent DESC;

-- ------------------------------------------------------------
-- 12. Window functions
-- ------------------------------------------------------------
SELECT
    name,
    category,
    price,
    ROW_NUMBER() OVER (
        PARTITION BY category
        ORDER BY price DESC
    ) AS category_rank
FROM products;

-- ------------------------------------------------------------
-- 13. UPDATE
-- ------------------------------------------------------------
UPDATE products
SET stock = stock - 1
WHERE id = 1
  AND stock > 0;

-- ------------------------------------------------------------
-- 14. Transaction test
-- ------------------------------------------------------------
BEGIN TRANSACTION;

UPDATE users
SET status = 'inactive'
WHERE username = 'eric';

-- Use ROLLBACK to undo the test change.
ROLLBACK;

-- ------------------------------------------------------------
-- 15. Index
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_user_id
    ON orders(user_id);

CREATE INDEX IF NOT EXISTS idx_products_category
    ON products(category);

-- ------------------------------------------------------------
-- 16. View
-- ------------------------------------------------------------
DROP VIEW IF EXISTS order_summary;

CREATE VIEW order_summary AS
SELECT
    o.id,
    o.order_no,
    u.username,
    o.total,
    o.status,
    o.created_at
FROM orders AS o
JOIN users AS u
    ON u.id = o.user_id;

SELECT * FROM order_summary;

-- ------------------------------------------------------------
-- 17. EXPLAIN QUERY PLAN
-- ------------------------------------------------------------
EXPLAIN QUERY PLAN
SELECT *
FROM orders
WHERE user_id = 1;

-- ============================================================
-- End of file
-- ============================================================

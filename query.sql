-- ============================================================
-- Web IDE SQL Lab - SQLite Test Queries
--
-- Safe to run with "Run All".
-- Uses the built-in SQL Lab demo database.
-- Covers common parser / editor / executor syntax.
-- ============================================================

-- 1. Basic SELECT / ORDER BY
SELECT
    id,
    name,
    email,
    region,
    created_at
FROM customers
ORDER BY id;


-- 2. WHERE / LIKE / IN / BETWEEN
SELECT
    id,
    sku,
    name,
    category,
    price,
    stock
FROM products
WHERE price BETWEEN 30 AND 300
  AND category IN ('Peripherals', 'Displays', 'Accessories')
  AND name LIKE '%o%'
ORDER BY price DESC;


-- 3. INNER JOIN
SELECT
    o.id AS order_id,
    c.name AS customer_name,
    c.region,
    o.status,
    o.total_amount,
    o.order_date
FROM orders AS o
JOIN customers AS c
    ON c.id = o.customer_id
ORDER BY o.order_date DESC;


-- 4. Multi-table JOIN
SELECT
    o.id AS order_id,
    c.name AS customer_name,
    p.name AS product_name,
    oi.quantity,
    oi.unit_price,
    ROUND(oi.quantity * oi.unit_price, 2) AS line_total
FROM order_items AS oi
JOIN orders AS o
    ON o.id = oi.order_id
JOIN customers AS c
    ON c.id = o.customer_id
JOIN products AS p
    ON p.id = oi.product_id
ORDER BY o.id, oi.id;


-- 5. GROUP BY / HAVING / aggregates
SELECT
    c.id,
    c.name,
    COUNT(o.id) AS order_count,
    ROUND(COALESCE(SUM(o.total_amount), 0), 2) AS total_spent,
    ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS average_order
FROM customers AS c
LEFT JOIN orders AS o
    ON o.customer_id = c.id
GROUP BY c.id, c.name
HAVING COUNT(o.id) >= 1
ORDER BY total_spent DESC;


-- 6. Scalar subquery
SELECT
    name,
    category,
    price
FROM products
WHERE price > (
    SELECT AVG(price)
    FROM products
)
ORDER BY price DESC;


-- 7. Correlated EXISTS
SELECT
    c.id,
    c.name,
    c.region
FROM customers AS c
WHERE EXISTS (
    SELECT 1
    FROM orders AS o
    WHERE o.customer_id = c.id
      AND o.status IN ('paid', 'shipped')
)
ORDER BY c.id;


-- 8. CASE expression
SELECT
    name,
    price,
    stock,
    CASE
        WHEN stock = 0 THEN 'out_of_stock'
        WHEN stock < 20 THEN 'low_stock'
        WHEN stock < 60 THEN 'normal'
        ELSE 'high_stock'
    END AS stock_level
FROM products
ORDER BY stock, name;


-- 9. CTE
WITH customer_totals AS (
    SELECT
        customer_id,
        COUNT(*) AS order_count,
        SUM(total_amount) AS total_spent
    FROM orders
    GROUP BY customer_id
)
SELECT
    c.name,
    COALESCE(t.order_count, 0) AS order_count,
    ROUND(COALESCE(t.total_spent, 0), 2) AS total_spent
FROM customers AS c
LEFT JOIN customer_totals AS t
    ON t.customer_id = c.id
ORDER BY total_spent DESC;


-- 10. Window functions
SELECT
    name,
    category,
    price,
    ROW_NUMBER() OVER (
        PARTITION BY category
        ORDER BY price DESC
    ) AS category_rank,
    ROUND(
        AVG(price) OVER (PARTITION BY category),
        2
    ) AS category_average
FROM products
ORDER BY category, category_rank;


-- 11. Recursive CTE
WITH RECURSIVE sequence(value) AS (
    VALUES (1)

    UNION ALL

    SELECT value + 1
    FROM sequence
    WHERE value < 5
)
SELECT
    value,
    value * value AS squared
FROM sequence;


-- 12. UNION ALL
SELECT
    'active_products' AS metric,
    COUNT(*) AS value
FROM products
WHERE active = 1

UNION ALL

SELECT
    'orders',
    COUNT(*)
FROM orders;


-- 13. NULL / COALESCE / CAST / ROUND
SELECT
    NULL AS null_value,
    COALESCE(NULL, 'fallback') AS fallback_value,
    CAST(42 AS TEXT) AS text_value,
    ROUND(123.4567, 2) AS rounded_value;


-- 14. SQLite date functions
SELECT
    id,
    order_date,
    strftime('%Y-%m', order_date) AS order_month
FROM orders
ORDER BY order_date;


-- 15. Safe schema PRAGMA
PRAGMA table_info(customers);


-- 16. Safe index PRAGMA
PRAGMA index_list(products);


-- 17. Safe foreign-key PRAGMA
PRAGMA foreign_key_list(orders);


-- 18. Database integrity check
PRAGMA quick_check;

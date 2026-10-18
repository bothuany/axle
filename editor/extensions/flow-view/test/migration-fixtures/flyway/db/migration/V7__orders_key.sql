-- Flyway: forward only.
ALTER TABLE orders ADD COLUMN "key" varchar(40);
ALTER TABLE orders DROP COLUMN legacy_ref;
ALTER TABLE public.orders RENAME COLUMN status TO state;
CREATE INDEX CONCURRENTLY idx_orders_key ON orders (key, created_at DESC);
CREATE TABLE order_notes (
    id bigint PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders (id),
    body text,
    CONSTRAINT uq_note UNIQUE (order_id, body)
);
DROP TABLE IF EXISTS tmp_orders;
UPDATE orders SET key = id::text; -- data, not DDL

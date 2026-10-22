// The tables a SQL string touches (src/poly/db.ts sqlTables): what a raw query's database card is named after.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, load } from './bundle.mjs'

let db
before(async () => {
	db = await load('src/poly/db.ts')
})
after(cleanup)

const tables = sql => db.sqlTables(sql).tables

test('sqlTables: FROM inside a function call names a column, not a table', () => {
	assert.deepEqual(tables('SELECT EXTRACT(YEAR FROM created_at) FROM orders'), ['orders'])
	assert.deepEqual(tables("SELECT TRIM(BOTH ' ' FROM name), SUBSTRING(code FROM 2 FOR 3) FROM customers c JOIN orders o ON o.cid = c.id"), ['customers', 'orders'])
	assert.deepEqual(tables("SELECT TRIM(BOTH ')' FROM name) FROM customers"), ['customers'], 'a parenthesis in a string does not close the call')
	assert.deepEqual(tables('SELECT a FROM t WHERE a IS DISTINCT FROM b'), ['t'])
})

test('sqlTables: subqueries in parentheses still name their tables', () => {
	assert.deepEqual(tables('SELECT id FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id)'), ['users', 'orders'])
	assert.deepEqual(tables('SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > (SELECT AVG(total) FROM orders))'), ['users', 'orders'])
	assert.deepEqual(tables('SELECT COUNT(*) FROM (SELECT id FROM payments) p'), ['payments'])
	assert.deepEqual(tables('WITH recent AS (SELECT * FROM orders WHERE created_at > now()) SELECT * FROM recent'), ['orders', 'recent'])
	assert.deepEqual(tables('SELECT x FROM ( WITH y AS (SELECT 1) SELECT * FROM refunds ) z'), ['refunds'])
})

test('sqlTables: FOR UPDATE and ON DUPLICATE KEY UPDATE are not an UPDATE of a table', () => {
	assert.deepEqual(db.sqlTables('SELECT id FROM jobs FOR UPDATE SKIP LOCKED'), { tables: ['jobs'], writes: false, verb: 'SELECT' })
	assert.deepEqual(tables('SELECT id FROM jobs WHERE state = 1 FOR NO KEY UPDATE NOWAIT'), ['jobs'])
	assert.deepEqual(db.sqlTables('INSERT INTO carts (id, total) VALUES (1, 2) ON DUPLICATE KEY UPDATE total = 2'), { tables: ['carts'], writes: true, verb: 'INSERT' })
	assert.deepEqual(db.sqlTables('UPDATE orders SET status = 1 WHERE id = 2'), { tables: ['orders'], writes: true, verb: 'UPDATE' })
	assert.deepEqual(tables('DELETE FROM sessions WHERE expires < now()'), ['sessions'])
})

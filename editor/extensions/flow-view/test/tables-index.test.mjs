// The table index: what it does with the answers of the code index and the C# analyzer (labels, partial walks, a backend that is
// not ready), how an edit is resolved to an entity, and that the worker's walk starts over when a file changes.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Index, ROOT } from './helpers.mjs'
import { cleanup, load } from './bundle.mjs'

let t
let flowtext
before(async () => {
	t = await load('src/mcp/tableIndex.ts')
	flowtext = await load('src/mcp/flowtext.ts')
})
after(cleanup)

const entry = (id, http, controller, action, source = 'poly') => ({ id, http, controller, action, file: '/w/x', line: 1, source })
const use = (e, over = {}) => ({ entry: e, table: 'orders', schemaName: null, entity: 'Order', write: false, guess: false, card: 'orders', from: 'Svc.go', file: '/w/Svc.java', line: 3, ops: ['findAll'], ...over })
const span = (file, line, endLine) => ({ file, line, endLine })
const entity = (over = {}) => ({ entity: 'Order', table: 'orders', schemaName: null, orm: 'JPA', guess: false, spans: [span('/w/Order.java', 10, 20)], ...over })

/** Fake backends that count the questions they are asked. */
function fakes({ entries, polyUses = [], roslynUses, entities = [], roslynEntities, polyDone = [true], polyReady = true }) {
	const calls = { polyTables: 0, roslynTables: 0, roslynEntities: 0 }
	const steps = [...polyDone]
	return {
		calls,
		deps: {
			entries: () => entries,
			poly: {
				isReady: polyReady,
				entities: async () => entities,
				tables: async () => {
					calls.polyTables++
					const done = steps.length > 1 ? steps.shift() : steps[0]
					return { uses: polyUses, done, checked: done ? entries.filter(e => e.source === 'poly').length : 1, total: entries.filter(e => e.source === 'poly').length }
				},
			},
			analyzer: {
				isReady: roslynUses !== undefined,
				entities: async () => { calls.roslynEntities++; return roslynEntities ? { entities: roslynEntities } : undefined },
				tables: async () => { calls.roslynTables++; return { uses: roslynUses ?? [], done: true, checked: 1, total: 1 } },
			},
		},
	}
}

test('a table answer splits writes and reads, and a guessed card is not certain', async () => {
	const entries = [entry('p1', 'POST /orders', 'OrderController', 'create'), entry('p2', 'GET /orders', 'OrderController', 'list'), entry('p3', 'GET /report', 'ReportController', 'run')]
	const { deps } = fakes({ entries, entities: [entity()], polyUses: [use('p1', { write: true, ops: ['save'] }), use('p2'), use('p3', { guess: true, ops: ['SELECT'] })] })
	const answer = await new t.TableIndex(deps).lookup('orders', 1000)
	assert.deepEqual([answer.endpoints, answer.writers, answer.readers], [3, 1, 2])
	assert.deepEqual(answer.uses.map(u => [u.endpoint.label, u.mode, u.certain]), [['GET /orders', 'read', true], ['GET /report', 'read', false], ['POST /orders', 'write', true]])
	assert.equal(answer.guess, false)
	const text = t.tableImpactText(answer, f => f).join('\n')
	assert.match(text, /Writes \(1\):\n- POST \/orders Order\.create {2}via Svc\.go \(\/w\/Svc\.java:3\), card orders \[save\]\n/)
	assert.match(text, /GET \/report Report\.run.*~table\? \(guessed\)/)
	assert.match(text, /Not checked: dynamic SQL, views, stored procedures and triggers; other services or reports/)
	assert.match(text, /migrations \(not mapped yet\)/)
})

test('an entity is found by its class name or its table name, any case, schema prefix ignored', async () => {
	const entries = [entry('p1', 'GET /orders', 'OrderController', 'list')]
	const { deps } = fakes({ entries, entities: [entity({ table: 'sales.Orders', schemaName: 'sales' })], polyUses: [use('p1', { table: 'Orders', schemaName: 'sales' })] })
	const index = new t.TableIndex(deps)
	for (const name of ['Order', 'order', 'orders', 'SALES.ORDERS', '"orders"']) {
		const answer = await index.lookup(name, 1000)
		assert.equal(answer?.endpoints, 1, name)
	}
	assert.equal(await index.lookup('customers', 1000), undefined)
	assert.deepEqual(await index.known(), ['sales.Orders'])
})

test('a table only raw SQL names is found through the cards, and is a guess', async () => {
	const entries = [entry('p1', 'GET /x', 'XController', 'get')]
	const { deps } = fakes({ entries, polyUses: [use('p1', { table: 'audit_log', entity: 'audit_log', guess: true })] })
	const answer = await new t.TableIndex(deps).lookup('audit_log', 1000)
	assert.equal(answer.guess, true)
	assert.equal(answer.entity, undefined)
	assert.equal(answer.uses[0].certain, false)
})

test('the analyzer is only asked when it is ready, and a C# endpoint left out is said', async () => {
	const entries = [entry('p1', 'GET /a', 'A', 'a'), entry('r1', 'GET /b', 'B', 'b', 'roslyn')]
	const idle = fakes({ entries, entities: [entity()], polyUses: [use('p1')] })
	const answer = await new t.TableIndex(idle.deps).lookup('orders', 1000)
	assert.deepEqual([idle.calls.roslynTables, idle.calls.roslynEntities], [0, 0], 'a table question must not start the analyzer');
	assert.ok(answer.notes.some(n => /C# analyzer is not loaded/.test(n)), answer.notes.join())
	assert.match(t.tableImpactText(answer, f => f).join('\n'), /partial: .*C# analyzer is not loaded/)

	const up = fakes({ entries, entities: [entity()], polyUses: [use('p1')], roslynUses: [use('r1', { write: true, guess: false })], roslynEntities: [] })
	const both = await new t.TableIndex(up.deps).lookup('orders', 1000)
	assert.equal(both.endpoints, 2)
	assert.deepEqual(both.uses.map(u => u.endpoint.source).sort(), ['poly', 'roslyn'])
	assert.equal(both.notes.length, 0)
})

test('a walk that did not finish is partial, and asking again continues it', async () => {
	const entries = [entry('p1', 'GET /a', 'A', 'a'), entry('p2', 'GET /b', 'B', 'b'), entry('p3', 'GET /c', 'C', 'c')]
	const { deps, calls } = fakes({ entries, entities: [entity()], polyUses: [use('p1')], polyDone: [false, true] })
	const index = new t.TableIndex(deps)
	const first = await index.lookup('orders', 1000)
	assert.ok(first.notes.some(n => /walked 1 of 3 entry points so far: ask again/.test(n)), first.notes.join())
	assert.ok(first.checked < first.of)
	const second = await index.lookup('orders', 1000)
	assert.equal(second.notes.length, 0)
	assert.equal(calls.polyTables, 2)
})

test('an edit resolves to the entities whose lines it overlaps, a file without lines to all of its entities', async () => {
	const list = [entity(), entity({ entity: 'Line', table: 'order_lines', spans: [span('/w/Order.java', 30, 40), span('/w/LineConfig.java', 5, 25)] })]
	const named = (file, ranges) => t.entitiesTouched(list, file, ranges).map(h => h.entity.entity)
	assert.deepEqual(named('/w/Order.java', [{ start: 12, end: 12 }]), ['Order'])
	assert.deepEqual(named('/w/Order.java', [{ start: 35, end: 36 }]), ['Line'])
	assert.deepEqual(named('/w/Order.java', [{ start: 25, end: 28 }]), [], 'between the two classes')
	assert.deepEqual(named('/w/Order.java', undefined), ['Order', 'Line'])
	assert.deepEqual(named('/w/LineConfig.java', [{ start: 6, end: 7 }]), ['Line'], 'the ORM configuration changes the entity')
	assert.deepEqual(named('C:\\W\\ORDER.java'.replace(/^C:\\W/, '/w'), undefined), ['Order', 'Line'], 'paths compare the way Windows and VS Code spell them')
	assert.deepEqual(named('/w/Other.java', undefined), [])
})

test('only a changed entity makes the index walk; the changed tables carry who reads and writes them', async () => {
	const entries = [entry('p1', 'POST /orders', 'O', 'create'), entry('p2', 'GET /orders', 'O', 'list')]
	const { deps, calls } = fakes({ entries, entities: [entity()], polyUses: [use('p1', { write: true }), use('p2')] })
	const index = new t.TableIndex(deps)
	const none = await index.changed([{ file: '/w/Service.java', ranges: [{ start: 1, end: 2 }] }], 4, 1000)
	assert.deepEqual([none.tables.length, calls.polyTables], [0, 0], 'a method edit costs no table walk')
	const hit = await index.changed([{ file: '/w/Order.java', ranges: [{ start: 11, end: 11 }] }], 4, 1000)
	assert.equal(hit.tables.length, 1)
	assert.deepEqual([hit.tables[0].entity, hit.tables[0].table, hit.tables[0].line, hit.tables[0].writers, hit.tables[0].readers], ['Order', 'orders', 10, 1, 1])
	assert.equal(t.usedBy(hit.tables[0]), '2 endpoints read or write it')
	assert.equal(t.usedBy({ endpoints: 0, writers: 0, readers: 0 }), 'no endpoint reads or writes it')
})

test('a table nobody reaches says so', async () => {
	const { deps } = fakes({ entries: [entry('p1', 'GET /a', 'A', 'a')], entities: [entity({ entity: 'Audit', table: 'audit' })] })
	const answer = await new t.TableIndex(deps).lookup('Audit', 1000)
	assert.equal(answer.endpoints, 0)
	assert.match(t.tableImpactText(answer, f => f).join('\n'), /No endpoint reads or writes it\./)
})

test('flow_text marks a guessed table with ~table and lists the guesses', () => {
	const db = (table, guess) => ({ callLine: 5, edgeKind: 'db', ...(guess ? { guess: true } : {}), node: { key: table, symbolId: null, label: `Ctx.${table}`, sub: 'ctx', kind: 'db', file: null, startLine: 0, endLine: 0, code: null, children: [], schema: { entity: table, table, dbSchemaName: null, context: 'ctx', columns: [], relations: [], ops: [], writes: false, file: null, line: 0 } } })
	const root = { key: 'r', symbolId: 'r', label: 'Svc.run', sub: '', kind: 'method', file: '/w/Svc.cs', startLine: 1, endLine: 9, code: null, children: [db('orders', false), db('invoices', true)] }
	const text = flowtext.flowToText(root, { rel: f => f })
	assert.deepEqual(text.tables, ['orders', 'invoices'])
	assert.deepEqual(text.guessed, ['invoices'])
	assert.match(text.text, /-> L5 \[db\] Ctx\.invoices \(ctx\) ~table$/m)
	assert.doesNotMatch(text.text, /Ctx\.orders.*~table/)
})

// The worker's own cache: the walk starts over after a file changes.
let dir
let index
before(async () => {
	dir = mkdtempSync(join(tmpdir(), 'flow-tables-'))
	cpSync(join(ROOT, 'test', 'table-fixtures', 'java-jpa'), dir, { recursive: true })
	index = new Index(dir)
	await index.ready
})
after(async () => {
	await index?.close()
	rmSync(dir, { recursive: true, force: true })
})

test('the worker walks a few entry points at a time and remembers where it stopped', async () => {
	const none = await index.request('tables', 0)
	assert.deepEqual([none.done, none.checked, none.total], [false, 0, 4], 'no time, no walk')
	const all = await index.request('tables', 5000)
	assert.deepEqual([all.done, all.checked, all.total], [true, 4, 4])
	assert.deepEqual([...new Set(all.uses.map(u => u.table))].sort(), ['Invoice', 'orders'])
	const again = await index.request('tables', 5000)
	assert.equal(again.uses.length, all.uses.length, 'a finished walk is kept')
})

test('an edit to an entity file rebuilds the answer: the table is renamed, the endpoints follow', async () => {
	const file = join(dir, 'src', 'main', 'java', 'com', 'acme', 'Order.java')
	writeFileSync(file, readFileSync(file, 'utf8').replace('name = "orders"', 'name = "purchase_orders"'))
	await index.request('changed', file)
	const after = await index.request('tables', 5000)
	assert.deepEqual([...new Set(after.uses.map(u => u.table))].sort(), ['Invoice', 'orders', 'purchase_orders'])
	// The raw SQL string still says "orders": no entity has that name any more, so that card is a guess about a table nobody maps.
	assert.ok(after.uses.filter(u => u.table === 'orders').every(u => u.guess))
	assert.ok(after.uses.filter(u => u.table === 'purchase_orders').every(u => !u.guess))
	const entities = await index.request('entities')
	assert.equal(entities.find(e => e.entity === 'Order').table, 'purchase_orders')
	assert.equal(entities.find(e => e.entity === 'Order').guess, false)
	// Dropping the name makes the table a naming default, and says so.
	writeFileSync(file, readFileSync(file, 'utf8').replace(/@Table\(name = "purchase_orders"\)\r?\n/, ''))
	await index.request('changed', file)
	const guessed = await index.request('entities')
	assert.equal(guessed.find(e => e.entity === 'Order').guess, true)
	const uses = (await index.request('tables', 5000)).uses.filter(u => u.entity === 'Order')
	assert.ok(uses.length > 0 && uses.every(u => u.guess), 'a card of an entity without @Table is a guess')
})

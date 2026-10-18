// A changed entity end to end on a real index: the turn impact names its table and the endpoints that use it, and the change set draws
// a root item for the table with each endpoint's flow cut down to the path that reaches the marked database card.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Index, ROOT } from './helpers.mjs'
import { cleanup, load } from './bundle.mjs'
import { join } from 'node:path'

const FOLDER = join(ROOT, 'test', 'table-fixtures', 'java-jpa')
const file = name => join(FOLDER, 'src', 'main', 'java', 'com', 'acme', name)

let impact
let changeSet
let tableIndex
let index
let entries
let asked
before(async () => {
	impact = await load('src/mcp/turnImpact.ts')
	changeSet = await load('src/changeSet.ts')
	tableIndex = await load('src/mcp/tableIndex.ts')
	index = new Index(FOLDER)
	await index.ready
	entries = (await index.request('entries')).map(e => ({ ...e, source: 'poly' }))
	asked = { tables: 0 }
})
after(async () => {
	await index?.close()
	cleanup()
})

const deps = (rangesOf) => {
	const tables = new tableIndex.TableIndex({
		entries: () => entries,
		poly: { isReady: true, entities: () => index.request('entities'), tables: ms => { asked.tables++; return index.request('tables', ms) } },
		analyzer: { isReady: false, entities: async () => undefined, tables: async () => undefined },
	})
	return {
		analyzer: { isReady: false },
		poly: { isReady: true, refresh: async () => undefined, methods: f => index.request('methods', f) },
		endpoints: { cached: () => entries },
		providerFor: () => ({ impact: async t => ({ label: 'endpoint', items: [] }), graph: async t => index.graph(t.id), callers: async () => null }),
		rangesOf,
		tables,
	}
}

test('an edit in an entity file names the table and every endpoint that reads or writes it', async () => {
	const r = await impact.turnImpact([file('Order.java')], deps(async () => undefined))
	assert.equal(r.tables.length, 1)
	const [t] = r.tables
	assert.deepEqual([t.entity, t.table, t.guess, t.endpoints, t.writers, t.readers], ['Order', 'orders', false, 3, 1, 2])
	assert.deepEqual(t.uses.map(u => `${u.mode} ${u.endpoint.label} ${u.certain ? 'certain' : 'guessed'}`), ['read GET /orders certain', 'read GET /reports/revenue guessed', 'write POST /orders certain'])
	assert.deepEqual(r.flows, [], 'no changed method: the call graph has nothing to add')
})

test('an edit in a service method costs no table walk and names no table', async () => {
	asked.tables = 0
	const methods = await index.request('methods', file('OrderService.java'))
	const place = methods.find(m => m.name.endsWith('place'))
	const r = await impact.turnImpact([file('OrderService.java')], deps(async () => [{ start: place.startLine + 1, end: place.startLine + 1 }]))
	assert.deepEqual(r.tables, [])
	assert.equal(asked.tables, 0)
})

test('the change set draws a root item for the table and each endpoint cut down to the marked database card', async () => {
	const provider = new changeSet.ChangeSetProvider({
		impactOf: (files, limits) => impact.turnImpact(files, deps(async () => undefined), limits),
		providerFor: () => ({ graph: async t => index.graph(t.id), callers: async () => null, impact: async () => ({ label: 'endpoint', items: [] }) }),
		annotate: async () => undefined,
	})
	provider.use({ label: 'Changes since main', files: [file('Order.java')] })
	const root = await provider.graph()
	const [table, ...flows] = root.children.map(c => c.node)
	assert.equal(table.label, 'Order changed → table orders')
	assert.equal(table.sub, '3 endpoints read or write it')
	assert.equal(table.kind, 'db')
	assert.match(root.sub, /1 changed file · 0 endpoints · 1 changed table \(3 endpoints read or write it; not checked: dynamic SQL/)
	assert.equal(flows.length, 3)
	const path = n => n.children.length ? `${n.label}${n.children.map(c => ` > ${path(c.node)}`).join('')}` : `${n.label}${n.tableChange ? ' [table changed]' : ''}`
	assert.deepEqual(flows.map(f => path(f)).sort(), [
		'OrderController.create > OrderService.place > orders [table changed]',
		'OrderController.list > OrderService.list > orders [table changed]',
		'OrderController.revenue > OrderService.revenueReport > orders [table changed]',
	].sort())
	// A flow's other cards are cut away: the controller reaches the service, the service reaches the table, nothing else is drawn.
	assert.ok(flows.every(f => f.children.length === 1))
	// The guessed link is drawn as a guess: the raw SQL edge carries `guess`.
	const revenue = flows.find(f => f.label === 'OrderController.revenue')
	assert.equal(revenue.children[0].node.children[0].guess, true)
})

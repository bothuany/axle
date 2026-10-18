// A changed migration works like a changed entity: the turn impact and the change set name the tables it alters, what it does to them,
// the endpoints that use them, and the code that may still use a column it drops. On real fixture projects through the index worker.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Index, ROOT } from './helpers.mjs'
import { cleanup, load } from './bundle.mjs'

let impact
let changeSet
let tableIndex
let migrations
let dir
let index
let entries

const FLYWAY = `ALTER TABLE orders ADD COLUMN "key" varchar(40);
ALTER TABLE orders DROP COLUMN legacy_ref;
ALTER TABLE orders RENAME COLUMN status TO state;
`

before(async () => {
	impact = await load('src/mcp/turnImpact.ts')
	changeSet = await load('src/changeSet.ts')
	tableIndex = await load('src/mcp/tableIndex.ts')
	migrations = await load('src/poly/migrations.ts')
	dir = mkdtempSync(join(tmpdir(), 'flow-migration-'))
	cpSync(join(ROOT, 'test', 'table-fixtures', 'java-jpa'), dir, { recursive: true })
	// Code that still reads the column the migration drops: a getter in the service, and a mention in a file that knows no Order.
	const service = join(dir, 'src', 'main', 'java', 'com', 'acme', 'OrderService.java')
	writeFileSync(service, readFileSync(service, 'utf8').replace('public List<Order> list() {', 'public String refOf(Order o) {\n        return o.getLegacyRef();\n    }\n\n    public List<Order> list() {'))
	writeFileSync(join(dir, 'src', 'main', 'java', 'com', 'acme', 'Unrelated.java'), 'package com.acme;\npublic class Unrelated { String legacy_ref; }\n')
	mkdirSync(join(dir, 'db', 'migration'), { recursive: true })
	writeFileSync(join(dir, 'db', 'migration', 'V8__orders_key.sql'), FLYWAY)
	index = new Index(dir)
	await index.ready
	entries = (await index.request('entries')).map(e => ({ ...e, source: 'poly' }))
})
after(async () => {
	await index?.close()
	rmSync(dir, { recursive: true, force: true })
	cleanup()
})

const migrationFile = () => join(dir, 'db', 'migration', 'V8__orders_key.sql')
const tables = () => new tableIndex.TableIndex({
	entries: () => entries,
	poly: { isReady: true, entities: () => index.request('entities'), tables: ms => index.request('tables', ms), mentions: q => index.request('mentions', q) },
	analyzer: { isReady: false, entities: async () => undefined, tables: async () => undefined },
})
const deps = () => ({
	analyzer: { isReady: false },
	poly: { isReady: true, refresh: async () => undefined, methods: f => index.request('methods', f) },
	endpoints: { cached: () => entries },
	providerFor: () => ({ impact: async () => ({ label: 'endpoint', items: [] }), graph: async t => index.graph(t.id), callers: async () => null }),
	rangesOf: async () => undefined,
	tables: tables(),
})

test('a changed migration names its table, what it does, the endpoints that use it and what may still use a dropped column', async () => {
	const r = await impact.turnImpact([migrationFile()], deps())
	assert.equal(r.tables.length, 1)
	const [t] = r.tables
	assert.deepEqual([t.table, t.entity, t.mapped, t.endpoints, t.writers, t.readers], ['orders', undefined, 'Order', 3, 1, 2])
	const [m] = t.migrations
	assert.deepEqual([m.name, m.format, m.verb, m.summary], ['V8__orders_key', 'flyway', 'alters', 'adds key, drops legacy_ref, renames status → state'])
	assert.equal(m.line, 1)
	// Dropped and renamed-away columns are both searched, in files that also know orders or Order: the field status in Order.java, the getter
	// of legacy_ref and the SQL that selects status in OrderService.java. Unrelated.java mentions legacy_ref but knows neither.
	assert.deepEqual(m.mayStillUse.map(x => `${x.file.split(/[\\/]/).pop()}:${x.line} ${x.column}`), ['Order.java:17 status', 'OrderService.java:22 legacy_ref', 'OrderService.java:30 status'])
	const text = tableIndex.tableImpactText(t, f => f.split(/[\\/]/).pop()).join('\n')
	assert.match(text, /Migration V8__orders_key \(flyway\) alters orders: adds key, drops legacy_ref, renames status → state\./)
	assert.match(text, /May still use what it removes \(a guess: the column's name is mentioned there\): status in Order\.java:17, legacy_ref in OrderService\.java:22, status in OrderService\.java:30\./)
	assert.match(text, /3 endpoints read or write it/)
	assert.match(tableIndex.describeChanged(t), /^table orders, migration V8__orders_key alters it: adds key, drops legacy_ref, renames status → state, 3 endpoints read or write it$/)
})

test('the change set draws the migration as a root item and marks each database card with what it adds and drops', async () => {
	const provider = new changeSet.ChangeSetProvider({
		impactOf: (files, limits) => impact.turnImpact(files, deps(), limits),
		providerFor: () => ({ graph: async t => index.graph(t.id), callers: async () => null, impact: async () => ({ label: 'endpoint', items: [] }) }),
		annotate: async () => undefined,
	})
	provider.use({ label: 'Changes since main', files: [migrationFile()] })
	const root = await provider.graph()
	const [item, ...flows] = root.children.map(c => c.node)
	assert.equal(item.label, 'migration V8__orders_key alters orders (adds key, drops legacy_ref, renames status → state)')
	assert.match(item.sub, /^3 endpoints read or write it · 3 places may still use status, legacy_ref \(guess\)$/)
	assert.equal(flows.length, 3)
	const cards = []
	const walk = n => { if (n.tableChange) cards.push(n); n.children.forEach(c => walk(c.node)) }
	flows.forEach(walk)
	assert.equal(cards.length, 3)
	assert.deepEqual(cards[0].tableChange.migration, [{ name: 'V8__orders_key', summary: 'adds key, drops legacy_ref, renames status → state', added: ['key'], dropped: ['legacy_ref', 'status'] }])
	assert.equal(cards[0].tableChange.entity, undefined, 'no entity changed, only a migration')
	assert.match(root.sub, /1 changed file · 3 endpoints · 1 changed table/)
	const { items } = await provider.impact()
	assert.equal(items.length, 3)
})

test('an entity and a migration that change the same table are one table with two reasons', async () => {
	const order = join(dir, 'src', 'main', 'java', 'com', 'acme', 'Order.java')
	const both = await tables().changed([{ file: order }, { file: migrationFile(), text: FLYWAY }], 12, 5000)
	assert.equal(both.tables.length, 1)
	assert.deepEqual([both.tables[0].entity, both.tables[0].migrations.length], ['Order', 1])
	const provider = new changeSet.ChangeSetProvider({
		impactOf: async () => ({ files: 2, flows: [], changed: [], tables: both.tables, more: 0 }),
		providerFor: () => ({ graph: async t => index.graph(t.id), callers: async () => null, impact: async () => ({ label: 'endpoint', items: [] }) }),
		annotate: async () => undefined,
	})
	provider.use({ label: 'Changes', files: [order, migrationFile()] })
	const root = await provider.graph()
	assert.deepEqual(root.children.slice(0, 2).map(c => c.node.label), ['Order changed → table orders', 'migration V8__orders_key alters orders (adds key, drops legacy_ref, renames status → state)'])
})

test('a Django migration names a model: the models of the project say which table, and by convention it is a guess', async () => {
	const dj = mkdtempSync(join(tmpdir(), 'flow-django-'))
	try {
		cpSync(join(ROOT, 'test', 'table-fixtures', 'django-default'), dj, { recursive: true })
		mkdirSync(join(dj, 'shop', 'migrations'), { recursive: true })
		const file = join(dj, 'shop', 'migrations', '0002_product_sku.py')
		const text = 'from django.db import migrations, models\n\nclass Migration(migrations.Migration):\n    operations = [\n        migrations.AddField(model_name="product", name="sku", field=models.CharField(max_length=20)),\n        migrations.RemoveField(model_name="product", name="price"),\n    ]\n'
		writeFileSync(file, text)
		const own = new Index(dj)
		await own.ready
		try {
			const ents = await own.request('entities')
			const ownEntries = (await own.request('entries')).map(e => ({ ...e, source: 'poly' }))
			const ti = new tableIndex.TableIndex({ entries: () => ownEntries, poly: { isReady: true, entities: async () => ents, tables: ms => own.request('tables', ms) }, analyzer: { isReady: false, entities: async () => undefined, tables: async () => undefined } })
			const r = await ti.changed([{ file, text }], 12, 5000)
			assert.equal(r.tables.length, 1)
			const [t] = r.tables
			assert.deepEqual([t.table, t.mapped, t.guess, t.endpoints, t.migrations[0].summary], ['shop_product', 'Product', true, 2, 'adds sku, drops price'])
			assert.match(tableIndex.tableImpactText(t, f => f).join('\n'), /The table name "shop_product" is a naming default/)
		} finally {
			await own.close()
		}
	} finally {
		rmSync(dj, { recursive: true, force: true })
	}
})

test('a column is found as written, in camel and Pascal case and in a getter, never as a longer name', () => {
	const re = migrations.mentionPattern('legacy_ref')
	for (const hit of ['order.legacy_ref = 1', 'o.legacyRef', 'LegacyRef { get; set; }', 'o.getLegacyRef()', 'setLegacyRef(x)', 'SELECT legacy_ref FROM t']) {
		assert.equal(re.test(hit), true, hit)
	}
	for (const miss of ['legacy_ref_id', 'legacyRefId', 'my_legacy_ref', 'xlegacyRef', 'LegacyReference']) {
		assert.equal(re.test(miss), false, miss)
	}
	assert.equal(migrations.mentionPattern('Key').test('o.key'), true, 'a Pascal-case column is found in camel case too')
})

test('a Rails migration names tables only, and says so; a file that is no migration is nothing', async () => {
	const rails = 'class A < ActiveRecord::Migration[7.1]\n  def change\n    add_column :orders, :key, :string\n  end\nend\n'
	const r = await tables().changed([{ file: join(dir, 'db', 'migrate', '2024_add_key.rb'), text: rails }, { file: join(dir, 'notes.sql'), text: 'select 1;' }], 12, 5000)
	assert.equal(r.tables.length, 1)
	assert.equal(r.tables[0].migrations[0].namesOnly, true)
	assert.ok(r.notes.some(n => /Rails migrations name tables by convention only/.test(n)), r.notes.join())
	assert.match(tableIndex.tableImpactText(r.tables[0], f => f).join('\n'), /\(rails, table names only\)/)
})

// The same question for C#, answered by the Roslyn analyzer itself: its `tables` command prints what the server's /api/entities and /api/tables
// hold (the entities EF maps, the database cards each controller action reaches), and the table index turns that into the same answer as
// for the other languages. The fixture stands in for EF Core and ASP.NET with types of the same names, so nothing is restored from the network.
// Skipped where the analyzer is not built (`dotnet build analyzer`) or there is no .NET 10 SDK.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { ROOT } from './helpers.mjs'
import { cleanup, load } from './bundle.mjs'

const DLL = resolve(ROOT, '..', '..', '..', 'analyzer', 'bin', 'Debug', 'net10.0', 'FlowAnalyzer.dll')
const FIXTURE = join(ROOT, 'test', 'table-fixtures-cs', 'csharp-ef')
const EXPECTED = join(ROOT, 'test', 'table-expected', 'csharp-ef.txt')

const run = (args, opts = {}) => execFileSync('dotnet', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...opts })
function available() {
	if (!existsSync(DLL)) {
		return 'the analyzer is not built (dotnet build analyzer)'
	}
	try {
		return /^10\./.test(run(['--version']).trim()) ? undefined : '.NET 10 SDK not found'
	} catch {
		return 'dotnet not found'
	}
}
const skip = available()

let t
let dir
let facts
before(async () => {
	if (skip) {
		return
	}
	t = await load('src/mcp/tableIndex.ts')
	// A copy: the restore writes obj/ next to the project.
	dir = mkdtempSync(join(tmpdir(), 'flow-cs-'))
	cpSync(FIXTURE, join(dir, 'csharp-ef'), { recursive: true })
	const project = join(dir, 'csharp-ef', 'Shop.csproj')
	run(['restore', project])
	const out = run([DLL, 'tables', project])
	facts = JSON.parse(out.slice(out.indexOf('{')))
})
after(() => {
	cleanup()
	if (dir) {
		rmSync(dir, { recursive: true, force: true })
	}
})

const index = () => new t.TableIndex({
	entries: () => facts.entries.map(e => ({ ...e, source: 'roslyn' })),
	// No other language here: the code index is up and has nothing to say.
	poly: { isReady: true, entities: async () => [], tables: async () => ({ uses: [], done: true, checked: 0, total: 0 }) },
	analyzer: { isReady: true, entities: async () => ({ entities: facts.entities }), tables: async () => facts.tables },
})

test('c#: the entities EF maps, each table, its endpoints, and which names are guesses', { skip }, async () => {
	const rel = f => relative(join(dir, 'csharp-ef'), f).replace(/\\/g, '/')
	const table = index()
	const entities = (await table.entities()).list
	let out = `entry points: ${facts.entries.length}\nentities:\n` + entities.map(e => `  ${e.entity} -> ${e.table} (${e.orm}${e.guess ? ', name is a guess' : ''}) ${e.spans.map(s => `${rel(s.file)}:${s.line}-${s.endLine}`).join(' ')}`).sort().join('\n') + '\n'
	for (const name of [...new Set(entities.map(e => e.table))].sort()) {
		out += `\n${t.tableImpactText(await table.lookup(name, 1000), rel).join('\n')}\n`
	}
	if (process.env.UPDATE) {
		mkdirSync(join(ROOT, 'test', 'table-expected'), { recursive: true })
		writeFileSync(EXPECTED, out)
		return
	}
	assert.ok(existsSync(EXPECTED), 'no snapshot: run UPDATE=1 npm test, read test/table-expected/csharp-ef.txt, then commit it')
	assert.equal(out, readFileSync(EXPECTED, 'utf8'))
})

test('c#: a table named by [Table] or ToTable is certain, one that falls back to the DbSet name is a guess', { skip }, async () => {
	const by = Object.fromEntries(facts.entities.map(e => [e.entity, e]))
	assert.deepEqual([by.Order.guess, by.Customer.guess, by.Shipment.guess], [false, false, true])
	assert.equal(by.Shipment.table, 'Shipments')
	const use = (entity, write) => facts.tables.uses.find(u => u.entity === entity && u.write === write)
	assert.deepEqual([use('Order', true).guess, use('Order', false).guess, use('Customer', false).guess, use('Shipment', false).guess], [false, false, false, true])
	assert.equal(use('Order', true).ops.join(), 'Add')
})

test('c#: an edit to the entity, or to its IEntityTypeConfiguration, changes the entity', { skip }, async () => {
	const file = name => join(dir, 'csharp-ef', name)
	const { list } = await index().entities()
	const named = (name, ranges) => t.entitiesTouched(list, file(name), ranges).map(h => h.entity.entity)
	assert.deepEqual(named('Entities.cs', [{ start: 8, end: 8 }]), ['Order'])
	assert.deepEqual(named('Entities.cs', [{ start: 16, end: 16 }]), ['Customer'])
	assert.deepEqual(named('CustomerConfiguration.cs', [{ start: 9, end: 9 }]), ['Customer'], 'its configuration is the entity too')
	assert.deepEqual(named('Controllers.cs', undefined), [])
	const changed = await index().changed([{ file: file('CustomerConfiguration.cs') }], 4, 1000)
	assert.deepEqual(changed.tables.map(c => [c.entity, c.table, c.endpoints]), [['Customer', 'customers', 1]])
})

test('c#: ToTable written in OnModelCreating counts, and an edit in that statement changes that entity only', { skip }, async () => {
	const file = name => join(dir, 'csharp-ef', name)
	const { list } = await index().entities()
	const table = name => list.find(e => e.entity === name && e.spans.some(s => s.file.endsWith('ShopDb.cs')))?.table
	assert.deepEqual([table('Warehouse'), table('Supplier'), table('Account')], ['warehouses', 'suppliers', 'shop_accounts'])
	const named = line => t.entitiesTouched(list, file('ShopDb.cs'), [{ start: line, end: line }]).map(h => h.entity.entity)
	assert.deepEqual(named(16), ['Warehouse'], 'a chain on one line')
	assert.deepEqual(named(19), ['Supplier'], 'inside the lambda')
	assert.deepEqual(named(22), ['Account'])
	assert.deepEqual(named(10), [], 'a DbSet property is not a configuration')
})

test('c#: two entities with the same name resolve by their full type, not by the name', { skip }, async () => {
	const accounts = facts.entities.filter(e => e.entity === 'Account')
	assert.deepEqual(accounts.map(e => e.table).sort(), ['billing_accounts', 'shop_accounts'])
	const uses = facts.tables.uses.filter(u => u.entity === 'Account')
	assert.deepEqual(uses.map(u => `${u.from} -> ${u.table} ${u.guess ? 'guess' : 'certain'}`).sort(), ['BillingAccountsController.Create -> billing_accounts certain', 'ShopAccountsController.List -> shop_accounts certain'])
})

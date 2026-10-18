// What each migration format says: the parsers read the fixture migrations and the golden shows the operations they found.
// After an intended change: UPDATE=1 npm test, then read the diff of test/migration-expected.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ROOT } from './helpers.mjs'
import { cleanup, load } from './bundle.mjs'

const FIXTURES = join(ROOT, 'test', 'migration-fixtures')
const EXPECTED = join(ROOT, 'test', 'migration-expected')

let m
before(async () => {
	m = await load('src/poly/migrations.ts')
	if (process.env.UPDATE) {
		mkdirSync(EXPECTED, { recursive: true })
	}
})
after(cleanup)

const files = dir => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))

/** Django resolves a model to its table through the models of the project: here Order is mapped explicitly, the others by convention. */
const ctx = { djangoTable: (app, model) => (app === 'shop' && model.toLowerCase() === 'order' ? { table: 'orders', guess: false } : undefined) }

function describe(file) {
	const rel = relative(FIXTURES, file).replace(/\\/g, '/')
	const mig = m.parseMigration(file, readFileSync(file, 'utf8'), ctx)
	if (!mig) {
		return `${rel}: not a migration\n`
	}
	let out = `${rel}: ${mig.format} ${mig.name}${mig.namesOnly ? ' (table names only)' : ''}\n`
	for (const o of mig.ops) {
		out += `  L${o.line} ${o.op} ${o.table}${o.guess ? '?' : ''}${o.to ? ` -> ${o.to}` : ''}${o.columns.length ? ` [${o.columns.join(', ')}]` : ''}\n`
	}
	for (const t of [...new Set(mig.ops.map(o => o.table.split('.').pop().toLowerCase()))]) {
		out += `  ${m.verbOf(mig.ops, t)} ${t}: ${m.summarize(mig.ops, t)}${m.goneColumns(mig.ops, t).length ? ` | gone: ${m.goneColumns(mig.ops, t).join(', ')}` : ''}\n`
	}
	for (const n of mig.notes) {
		out += `  note: ${n}\n`
	}
	return out
}

for (const file of files(FIXTURES).sort()) {
	const rel = relative(FIXTURES, file).replace(/\\/g, '/')
	test(`migration: ${rel}`, () => {
		const actual = describe(file)
		const golden = join(EXPECTED, `${rel.replace(/\//g, '__')}.txt`)
		if (process.env.UPDATE) {
			writeFileSync(golden, actual)
			return
		}
		assert.ok(existsSync(golden), `no snapshot for ${rel}: run UPDATE=1 npm test, read test/migration-expected, then commit it`)
		assert.equal(actual, readFileSync(golden, 'utf8'))
	})
}

test('migration paths: any SQL, and code or markup in the folders migrations live in', () => {
	for (const f of ['db/migration/V1__x.sql', 'x.sql', 'shop/migrations/0001_initial.py', 'db/migrate/2024_add.rb', 'src/migrations/1-A.ts', 'Data/Migrations/20240101_A.cs', 'db/changelog/main.xml', 'alembic/versions/ab.py']) {
		assert.equal(m.isMigrationPath(f), true, f)
	}
	for (const f of ['shop/models.py', 'src/orders.ts', 'pom.xml', 'package.json', 'Data/Orders.cs']) {
		assert.equal(m.isMigrationPath(f), false, f)
	}
})

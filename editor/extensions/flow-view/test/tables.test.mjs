// Which endpoints read or write a table, per language, on real fixture projects through the polyglot index worker: the
// entities it finds, and for each table the answer `impact` gives (writes, reads, guesses, what was not checked).
// After an intended change: UPDATE=1 npm test, then read the diff of test/table-expected. A fixture without an expected file fails until then.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Index, ROOT } from './helpers.mjs'
import { cleanup, load } from './bundle.mjs'

const FIXTURES = join(ROOT, 'test', 'table-fixtures')
const EXPECTED = join(ROOT, 'test', 'table-expected')

let t
before(async () => {
	t = await load('src/mcp/tableIndex.ts')
	if (process.env.UPDATE) {
		mkdirSync(EXPECTED, { recursive: true })
	}
})
after(cleanup)

/** The index worker as the extension host's PolyIndex presents it to the table index. The analyzer is not loaded. */
export function depsOf(index, entries) {
	return {
		entries: () => entries,
		poly: {
			isReady: true,
			entities: () => index.request('entities'),
			tables: ms => index.request('tables', ms),
		},
		analyzer: { isReady: false, entities: async () => undefined, tables: async () => undefined },
	}
}

async function open(folder) {
	const index = new Index(folder)
	await index.ready
	const entries = (await index.request('entries')).map(e => ({ ...e, source: 'poly' }))
	return { index, entries, table: new t.TableIndex(depsOf(index, entries)) }
}

/** Every entity and table the fixture has, with what `impact` says about each table. */
async function describeTables(folder) {
	const { index, entries, table } = await open(folder)
	try {
		const rel = f => relative(folder, f).replace(/\\/g, '/')
		const entities = (await table.entities()).list
		const facts = await table.facts(20_000)
		let out = `entry points: ${entries.length}\n`
		out += 'entities:\n' + (entities.map(e => `  ${e.entity} -> ${e.table} (${e.orm}${e.guess ? ', name is a guess' : ''}) ${e.spans.map(s => `${rel(s.file)}:${s.line}-${s.endLine}`).join(' ')}`).sort().join('\n') || '  none') + '\n'
		const names = [...new Set([...entities.map(e => e.table), ...facts.uses.map(u => u.table)].map(n => n.toLowerCase().split('.').pop()))].sort()
		for (const name of names) {
			const answer = await table.lookup(name, 20_000)
			out += `\n${t.tableImpactText(answer, rel).join('\n')}\n`
		}
		if (!names.length) {
			out += `\nlookup of "orders": ${(await table.lookup('orders', 20_000)) === undefined ? 'unknown table' : 'found'}\n`
		}
		return out
	} finally {
		await index.close()
	}
}

for (const name of readdirSync(FIXTURES)) {
	test(`tables: ${name}`, async () => {
		const actual = await describeTables(join(FIXTURES, name))
		const file = join(EXPECTED, `${name}.txt`)
		if (process.env.UPDATE) {
			writeFileSync(file, actual)
			return
		}
		assert.ok(existsSync(file), `no snapshot for ${name}: run UPDATE=1 npm test, read test/table-expected/${name}.txt, then commit it`)
		assert.equal(actual, readFileSync(file, 'utf8'))
	})
}

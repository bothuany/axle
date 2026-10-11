// The hybrid: what the index could not resolve is asked to the language server (here a scripted fake).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Index, ROOT } from './helpers.mjs'

let LspRefiner
before(async () => {
	const outfile = join(mkdtempSync(join(tmpdir(), 'flow-refiner-')), 'lspResolve.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'poly', 'lspResolve.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	;({ LspRefiner } = await import(pathToFileURL(outfile).href))
})

const labels = node => node.children.map(c => `${c.guess ? '(guess) ' : ''}${c.node.label}`)

async function refined(fixture, answers) {
	const folder = join(ROOT, 'test', 'fixtures', fixture)
	const index = new Index(folder)
	try {
		await index.ready
		const [entry] = await index.request('entries')
		const lsp = {
			definitions: async (file, line, character) => {
				const text = readFileSync(file, 'utf8').split('\n')[line - 1].slice(character)
				const hit = Object.entries(answers).find(([name]) => text.startsWith(name))
				return hit ? [{ file: join(folder, hit[1].file), line: hit[1].line }] : []
			},
			implementations: async () => [],
		}
		const graph = await index.graph(entry.id)
		const pending = graph.pending?.map(p => p.name)
		return { pending, root: await new LspRefiner(index, lsp).refine(structuredClone(graph)) }
	} finally {
		await index.close()
	}
}

test('a call the index left unresolved is linked from the language server answer', async () => {
	const { pending, root } = await refined('hybrid', { charge_card: { file: 'gw_b.py', line: 2 }, refund_money: { file: 'gw_a.py', line: 4 } })
	assert.deepEqual(pending, ['charge_card', 'refund_money'])
	assert.deepEqual(labels(root), ['PaypalGateway.charge_card', 'StripeGateway.refund_money'])
	assert.equal(root.pending, undefined)
})

test('spliced nodes get keys of their own and the pending marks are gone', async () => {
	const { root } = await refined('hybrid', { charge_card: { file: 'gw_b.py', line: 2 }, refund_money: { file: 'gw_a.py', line: 4 } })
	const keys = []
	const sweep = node => { keys.push(node.key); assert.equal(node.pending, undefined); node.children.forEach(c => sweep(c.node)) }
	sweep(root)
	assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys}`)
})

test('a name-only guess is kept when the language server agrees, replaced when it disagrees, kept when it is silent', async () => {
	assert.deepEqual(labels((await refined('hybrid2', { audit: { file: 'gw_a.py', line: 6 } })).root), ['audit'])
	assert.deepEqual(labels((await refined('hybrid2', { audit: { file: 'gw_b.py', line: 2 } })).root), ['PaypalGateway.charge_card'])
	assert.deepEqual(labels((await refined('hybrid2', {})).root), ['(guess) audit'])
})

test('two refine calls that overlap each key their own spliced nodes', async () => {
	const folder = join(ROOT, 'test', 'fixtures', 'hybrid')
	const places = { charge_card: { file: 'gw_b.py', line: 2 }, refund_money: { file: 'gw_a.py', line: 4 } }
	const index = new Index(folder)
	try {
		await index.ready
		const [entry] = await index.request('entries')
		const graph = await index.graph(entry.id)
		let release
		const gate = new Promise(ok => { release = ok })
		let asked = 0
		let second
		const lsp = {
			definitions: async (file, line, character) => {
				const mine = ++asked
				if (mine === 2) {
					// The second refine starts while the first one is between two splices; it waits until the first is done.
					second = refiner.refine(structuredClone(graph))
				} else if (mine > 2) {
					await gate
				}
				const text = readFileSync(file, 'utf8').split('\n')[line - 1].slice(character)
				const hit = Object.entries(places).find(([name]) => text.startsWith(name))
				return hit ? [{ file: join(folder, hit[1].file), line: hit[1].line }] : []
			},
			implementations: async () => [],
		}
		const refiner = new LspRefiner(index, lsp)
		const first = await refiner.refine(structuredClone(graph))
		release()
		const keysOf = root => { const keys = []; const sweep = n => { keys.push(n.key); n.children.forEach(c => sweep(c.node)) }; sweep(root); return keys }
		for (const root of [first, await second]) {
			const keys = keysOf(root)
			assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys}`)
			assert.deepEqual(labels(root), ['PaypalGateway.charge_card', 'StripeGateway.refund_money'])
		}
	} finally {
		await index.close()
	}
})

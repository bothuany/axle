// One canvas for a change set (src/changeSetTree.ts): flows cut down to the paths that lead to a changed card, keys kept unique.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './helpers.mjs'

let t
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-changeset-'))
	const outfile = join(tmp, 'changeSetTree.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'changeSetTree.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	t = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const card = (key, file, line, children = [], diff) => ({ key, symbolId: null, label: key, sub: '', kind: 'method', file, startLine: line, endLine: line + 5, code: null, children: children.map(node => ({ callLine: line + 1, edgeKind: 'call', node })), ...(diff ? { diff } : {}) })
const changed = { added: [3], removed: [], plus: 1, minus: 0, source: 'git', base: 'main' }
const shape = n => ({ [n.key]: n.children.map(c => shape(c.node)) })

test('a flow keeps only the paths to a changed card, and the changed card keeps its direct callees', () => {
	const flow = card('ctrl', '/w/C.java', 1, [
		card('svc', '/w/S.java', 10, [
			card('repo', '/w/R.java', 20, [card('db', '/w/D.java', 30)], changed),
			card('audit', '/w/A.java', 40, [card('log', '/w/L.java', 50)]),
		]),
		card('cache', '/w/K.java', 60),
	])
	assert.deepEqual(shape(t.pruneToChanged(flow)), { ctrl: [{ svc: [{ repo: [{ db: [] }] }] }] })
	// The callee a changed card keeps is drawn without what it calls.
	const leaf = card('ctrl', '/w/C.java', 1, [card('svc', '/w/S.java', 10, [card('deep', '/w/X.java', 70)])], changed)
	assert.deepEqual(shape(t.pruneToChanged(leaf)), { ctrl: [{ svc: [] }] })
})

test('a flow with no changed card is dropped', () => {
	assert.equal(t.pruneToChanged(card('a', '/w/A.java', 1, [card('b', '/w/B.java', 9)])), null)
})

test('the change set root holds every branch with keys made unique, and finds which lines are already drawn', () => {
	const a = t.rekey(card('n1', '/w/A.java', 1, [card('n2', '/w/B.java', 10, [], changed)]), 'f0:')
	const b = t.rekey(card('n1', '/w/C.java', 1, [], changed), 'm0:')
	const root = t.changeSetRoot('Changes since main', '2 changed files', [a, b])
	assert.deepEqual(shape(root), { changes: [{ 'f0:n1': [{ 'f0:n2': [] }] }, { 'm0:n1': [] }] })
	assert.equal(root.file, null)
	assert.equal(root.children[0].edgeKind, 'call')
	// Windows spells the same file with backslashes and another drive-letter case.
	assert.equal(t.showsLine(root, '\\W\\B.java', 12), true)
	assert.equal(t.showsLine(root, '/w/B.java', 40), false)
})

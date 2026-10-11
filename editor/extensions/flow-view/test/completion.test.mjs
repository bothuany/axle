// What a card completion is made of besides a server's answer: who answers for a file, and the words under the answer.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './helpers.mjs'

let c
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-completion-'))
	const outfile = join(tmp, 'completion.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'completion.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	c = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('who answers for a file', () => {
	assert.equal(c.routeOf('C:\\ws\\Orders\\OrderService.cs'), 'roslyn')
	assert.equal(c.routeOf('/ws/App.java'), 'index')
	assert.equal(c.routeOf('/ws/app/main.PY'), 'index')
	for (const f of ['a.go', 'a.php', 'a.rb', 'a.rs']) assert.equal(c.routeOf(f), 'index', f)
	for (const f of ['a.ts', 'a.tsx', 'a.js', 'a.mjs', 'a.kt', 'a.swift', 'Makefile', 'a.cshtml']) assert.equal(c.routeOf(f), 'vscode', f)
	assert.ok(c.isScript('a.ts') && c.isScript('/x/b.jsx') && c.isScript('c.mjs'))
	assert.ok(!c.isScript('a.cs') && !c.isScript('a.java') && !c.isScript('a.json'))
})

test('words belong in an answer when typing, and after a trigger character only when the server had nothing', () => {
	assert.equal(c.wantsWords(undefined, 12), true)
	assert.equal(c.wantsWords(undefined, 0), true)
	assert.equal(c.wantsWords('.', 7), false)
	assert.equal(c.wantsWords('.', 0), true)
	assert.equal(c.wantsWords('(', 0), true)
})

test('the line before the cursor, and the word being typed', () => {
	const text = 'var a = 1;\r\n    order.Fi\r\n'
	assert.equal(c.lineBefore(text, 2, 13), '    order.Fi')
	assert.equal(c.lineBefore(text, 2, 11), '    order.')
	assert.equal(c.lineBefore(text, 9, 1), '')
	assert.equal(c.wordBefore(text, 2, 13), 'Fi')
	assert.equal(c.wordBefore(text, 2, 11), '')
})

test('words: the card first, then the file by use; not the word being typed', () => {
	const card = 'var order = repo.Find(id);\nreturn order.Total;'
	const file = 'class A { Total Total Total; helper(); other(); helper(); }'
	const words = c.rankWords(card, file, 'Tot', 50)
	assert.deepEqual(words.slice(0, 6), ['var', 'order', 'repo', 'Find', 'id', 'return'])
	assert.ok(words.indexOf('helper') < words.indexOf('other'), 'by use')
	assert.ok(words.includes('Total'))
	assert.ok(!c.rankWords(card, file, 'order', 50).includes('order'))
	assert.ok(!words.some(w => w.length < 2))
	assert.equal(c.rankWords(card, file, '', 3).length, 3)
})

test('the server\'s items stay first; a word that is also an item is not offered twice', () => {
	const server = [{ label: 'FindAsync', n: 1 }, { label: 'order', n: 2 }]
	const merged = c.mergeCompletions(server, ['order', 'Total', 'FindAsync'], label => ({ label, n: 0 }))
	assert.deepEqual(merged.items.map(i => i.label), ['FindAsync', 'order', 'Total'])
	assert.equal(merged.words, 1)
	assert.ok(c.WORD_SORT > 'z' && c.WORD_SORT > '9', 'words sort behind letters and digits')
})

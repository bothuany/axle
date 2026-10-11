// Mapping between a card's text (Monaco: 1-based) and the real document (VS Code: 0-based).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './helpers.mjs'

let m
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-cardmap-'))
	const outfile = join(tmp, 'cardmap.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'cardmap.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	m = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('a card position maps to the file position and back', () => {
	// A card that starts on file line 40: its line 1 is the document's line 39 (0-based).
	assert.deepEqual(m.toDoc(40, 1, 1), { line: 39, character: 0 })
	assert.deepEqual(m.toDoc(40, 3, 9), { line: 41, character: 8 })
	assert.deepEqual(m.toCard(40, { line: 41, character: 8 }), { lineNumber: 3, column: 9 })
	for (const [line, col] of [[1, 1], [2, 14], [7, 3]]) {
		const d = m.toDoc(40, line, col)
		assert.deepEqual(m.toCard(40, d), { lineNumber: line, column: col })
	}
})

test('lines of a card, and where its last line ends up after an edit', () => {
	assert.equal(m.lineCount('a'), 1)
	assert.equal(m.lineCount('a\r\nb\nc'), 3)
	assert.equal(m.endLineOf(10, 'a\nb\nc'), 12)
	assert.equal(m.endLineOf(10, 'a\nb\nc\nd\n'), 14) // a trailing newline is an empty last line
})

test('ranges map only when they lie inside the card', () => {
	// The card holds file lines 40..42 (3 lines).
	const inside = m.toCardRange(40, 3, { start: { line: 39, character: 4 }, end: { line: 40, character: 2 } })
	assert.deepEqual(inside, { startLineNumber: 1, startColumn: 5, endLineNumber: 2, endColumn: 3 })
	assert.equal(m.toCardRange(40, 3, { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } }), undefined) // the import header
	assert.equal(m.toCardRange(40, 3, { start: { line: 41, character: 0 }, end: { line: 42, character: 0 } }), undefined) // one line past the end
	assert.equal(m.lineInCard(40, 3, 38), false)
	assert.equal(m.lineInCard(40, 3, 41), true)
	assert.equal(m.lineInCard(40, 3, 42), false)
})

test('a sync never overwrites lines someone else changed', () => {
	const base = { expected: 'a\nb', last: 'a\nb' }
	assert.equal(m.planSync({ ...base, docText: 'a\r\nb', next: 'a\nb' }), 'skip')
	assert.equal(m.planSync({ ...base, docText: 'a\nb', next: 'a\nbc' }), 'apply')
	assert.equal(m.planSync({ ...base, docText: 'a\nX', next: 'a\nbc' }), 'conflict')
	assert.equal(m.planSync({ ...base, docText: undefined, next: 'a\nbc' }), 'conflict') // the file got shorter
})

test('the card text is found again only where it is unambiguous', () => {
	const doc = 'one\r\ntwo\r\nthree\r\nfour'
	assert.deepEqual(m.locateOnce(doc, 'two\nthree'), { start: { line: 1, character: 0 }, end: { line: 2, character: 5 } })
	assert.equal(m.locateOnce('x\nx', 'x'), undefined)
	assert.equal(m.locateOnce(doc, 'five'), undefined)
})

test('bodyless declarations (implemented elsewhere) are told from methods with a body', () => {
	for (const d of ['    Task<Order> Get(int id);', '    foo(x: number): void;', '    public abstract void Run();', 'public interface IOrders', '    Task SaveAsync(Order o, CancellationToken ct = default);'])
		assert.equal(m.isBodyless(d), true, d)
	for (const d of ['    public Task<Order> Get(int id)', '    public Order Get(int id) => _db.Find(id);', '    var x = Make();', '    function foo(a) {'])
		assert.equal(m.isBodyless(d), false, d)
})

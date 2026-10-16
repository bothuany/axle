// Which methods an agent's edit landed in, for the method-level turn impact (src/mcp/changedMethods.ts).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { structuredPatch } from 'diff'
import { ROOT } from './helpers.mjs'

let c
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-changed-'))
	const outfile = join(tmp, 'changedMethods.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'mcp', 'changedMethods.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	c = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

// Lines:          1      2          3       4      5       6          7       8      9
const BEFORE = ['import x', '', 'class A {', '  a() {', '    one', '  }', '  b() {', '    two', '  }', '}', ''].join('\n')
const METHODS = [
	{ id: 'a', name: 'A.a', startLine: 4, endLine: 6 },
	{ id: 'b', name: 'A.b', startLine: 7, endLine: 9 },
]
/** The ranges of the edit from BEFORE to `after`, the way AgentChanges computes them. */
const ranges = after => c.rangesFromHunks(structuredPatch('a', 'b', BEFORE, after, '', '', { context: 0 }).hunks)
const ids = r => ({ methods: r.methods.map(m => m.id), wholeFile: r.wholeFile })

test('a changed line inside one method names that method only', () => {
	const after = BEFORE.replace('    two', '    TWO')
	assert.deepEqual(ids(c.methodsTouched(METHODS, ranges(after))), { methods: ['b'], wholeFile: false })
})

test('edits in two methods name both, in file order', () => {
	const after = BEFORE.replace('    two', '    TWO').replace('    one', '    ONE')
	assert.deepEqual(ids(c.methodsTouched(METHODS, ranges(after))), { methods: ['a', 'b'], wholeFile: false })
})

test('an edit outside every method (an import) counts the whole file', () => {
	const after = BEFORE.replace('import x', 'import y')
	assert.deepEqual(ids(c.methodsTouched(METHODS, ranges(after))), { methods: [], wholeFile: true })
})

test('an added line inside a method names it', () => {
	const after = BEFORE.replace('    one', '    one\n    more')
	// The spans are of the current file: method a now ends a line later.
	const methods = [{ id: 'a', name: 'A.a', startLine: 4, endLine: 7 }, { id: 'b', name: 'A.b', startLine: 8, endLine: 10 }]
	assert.deepEqual(ids(c.methodsTouched(methods, ranges(after))), { methods: ['a'], wholeFile: false })
})

test('a removed line inside a method names it', () => {
	const after = BEFORE.replace('    one\n', '')
	const methods = [{ id: 'a', name: 'A.a', startLine: 4, endLine: 5 }, { id: 'b', name: 'A.b', startLine: 6, endLine: 8 }]
	assert.deepEqual(ids(c.methodsTouched(methods, ranges(after))), { methods: ['a'], wholeFile: false })
})

test('removing a whole method between two others names neither neighbour', () => {
	const three = ['class A {', '  a() {', '  }', '  b() {', '  }', '  c() {', '  }', '}', ''].join('\n')
	const without = three.replace('  b() {\n  }\n', '')
	const r = c.rangesFromHunks(structuredPatch('a', 'b', three, without, '', '', { context: 0 }).hunks)
	const methods = [{ id: 'a', name: 'A.a', startLine: 2, endLine: 3 }, { id: 'c', name: 'A.c', startLine: 4, endLine: 5 }]
	assert.deepEqual(ids(c.methodsTouched(methods, r)), { methods: [], wholeFile: true })
})

test('removing lines at the top or bottom of a file is outside every method', () => {
	assert.deepEqual(ids(c.methodsTouched(METHODS, ranges(BEFORE.replace('import x\n', '')))).wholeFile, true)
	assert.deepEqual(c.rangesFromHunks([{ newStart: 1, newLines: 0 }]), [{ start: 0, end: 1, gap: true }])
})

test('a new file names every method in it', () => {
	const r = c.rangesFromHunks(structuredPatch('a', 'b', '', BEFORE, '', '', { context: 0 }).hunks)
	assert.deepEqual(ids(c.methodsTouched(METHODS, r)), { methods: ['a', 'b'], wholeFile: false })
})

test('a nested function and the method around it both count', () => {
	const methods = [{ id: 'outer', name: 'outer', startLine: 1, endLine: 10 }, { id: 'inner', name: 'inner', startLine: 3, endLine: 5 }]
	assert.deepEqual(ids(c.methodsTouched(methods, [{ start: 4, end: 4 }])), { methods: ['outer', 'inner'], wholeFile: false })
})

test('no ranges: nothing changed, nothing counts', () => {
	assert.deepEqual(ids(c.methodsTouched(METHODS, [])), { methods: [], wholeFile: false })
})

test('ranges from hunks: changed and added lines are inclusive spans', () => {
	assert.deepEqual(c.rangesFromHunks([{ newStart: 5, newLines: 1 }, { newStart: 8, newLines: 3 }]), [{ start: 5, end: 5 }, { start: 8, end: 10 }])
})

test('spans match the text when every named method has its name on its line', () => {
	const text = 'class A {\n  a() {\n  }\n  get b() {\n  }\n}\n'
	assert.equal(c.spansMatch([{ id: '1', name: 'A.a', line: 2, startLine: 2, endLine: 3 }, { id: '2', name: 'A.b', line: 4, startLine: 4, endLine: 5 }], text), true)
	assert.equal(c.spansMatch([{ id: '1', name: 'A.a', line: 3, startLine: 3, endLine: 4 }], text), false, 'shifted by a line: stale')
	assert.equal(c.spansMatch([{ id: '1', name: '<anonymous>', line: 9, startLine: 9, endLine: 9 }], text), true, 'no identifier to check')
	assert.equal(c.spansMatch([], ''), true)
})

// Two agents on the same code (src/conflicts.ts): paths compared per checkout, methods and flows when known.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let c
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-conflicts-'))
	const outfile = join(tmp, 'conflicts.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'conflicts.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	c = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const session = (id, name, root, files, methods = {}, flows = {}) => ({ id, name, root, files: new Set(files), methods: new Map(Object.entries(methods)), flows: new Map(Object.entries(flows)) })

test('keys: relative to the checkout, forward slashes, case-folded on Windows', () => {
	assert.equal(c.key('C:\\Repo\\src\\Orders.cs', 'c:\\repo', 'win32'), 'src/orders.cs')
	assert.equal(c.key('C:/Repo/.insilode/worktrees/x/src/Orders.cs', 'C:\\Repo\\.insilode\\worktrees\\x', 'win32'), 'src/orders.cs')
	assert.equal(c.key('src/Orders.cs', 'C:\\Repo', 'win32'), 'src/orders.cs')
	assert.equal(c.key('D:\\elsewhere\\a.cs', 'C:\\Repo', 'win32'), undefined)
	assert.equal(c.key('/home/me/repo/src/Orders.cs', '/home/me/repo', 'linux'), 'src/Orders.cs')
	assert.equal(c.key('/tmp/x.ts', '/home/me/repo', 'linux'), undefined)
	assert.equal(c.key('/home/me/repo', '/home/me/repo', 'linux'), undefined)
	assert.ok(c.sameRoot('C:\\Repo\\', 'c:\\repo', 'win32'))
	assert.ok(!c.sameRoot('/a/Repo', '/a/repo', 'linux'))
})

test('two sessions in one checkout on one method: both rows, the shared checkout flagged', () => {
	const m = c.findConflicts([
		session('a', 'Claude', 'C:\\repo', ['src/orders.cs', 'src/a.cs'], { 'src/orders.cs#OrderService.Place': 'OrderService.Place' }, { 'e1': 'POST /orders' }),
		session('b', 'Claude 2', 'c:\\Repo', ['src/orders.cs'], { 'src/orders.cs#OrderService.Place': 'OrderService.Place', 'src/orders.cs#OrderService.Cancel': 'OrderService.Cancel' }, { 'e1': 'POST /orders' }),
		session('c', 'Codex', 'C:\\repo\\.insilode\\worktrees\\codex-1', ['src/other.cs']),
	], 'win32')
	assert.deepEqual([...m.keys()].sort(), ['a', 'b'])
	const [onA] = m.get('a')
	assert.deepEqual(onA, { id: 'b', name: 'Claude 2', sameCheckout: true, files: ['src/orders.cs'], methods: ['OrderService.Place'], flows: ['POST /orders'] })
	assert.equal(m.get('b')[0].name, 'Claude')
	assert.equal(c.conflictText(onA), 'Also editing OrderService.Place with Claude 2')
})

test('a worktree and the main checkout on one file: a conflict, not the same checkout', () => {
	const m = c.findConflicts([
		session('a', 'Claude', '/r', ['src/Orders.ts']),
		session('b', 'Codex', '/r/.insilode/worktrees/codex-1', ['src/Orders.ts', 'README.md']),
	], 'linux')
	const [x] = m.get('b')
	assert.equal(x.sameCheckout, false)
	assert.equal(c.conflictText(x), 'Also editing Orders.ts with Claude')
})

test('a shared flow without a shared file is no conflict; the flow names the files when no method is known', () => {
	assert.equal(c.findConflicts([
		session('a', 'A', '/r', ['x.ts'], {}, { f: 'GET /x' }),
		session('b', 'B', '/r', ['y.ts'], {}, { f: 'GET /x' }),
	], 'linux').size, 0)
	const m = c.findConflicts([
		session('a', 'A', '/r', ['src/x.ts', 'src/y.ts', 'src/z.ts'], {}, { f: 'GET /x' }),
		session('b', 'B', '/r', ['src/x.ts', 'src/y.ts', 'src/z.ts'], {}, { f: 'GET /x' }),
	], 'linux')
	assert.equal(c.conflictText(m.get('a')[0]), 'Also editing x.ts, y.ts +1 (GET /x) with B')
})

test('three sessions: each row lists every other it overlaps with', () => {
	const m = c.findConflicts([
		session('a', 'A', '/r', ['f']),
		session('b', 'B', '/r', ['f']),
		session('c', 'C', '/r/.insilode/worktrees/c', ['f']),
	], 'linux')
	assert.deepEqual(m.get('a').map(x => [x.id, x.sameCheckout]), [['b', true], ['c', false]])
	assert.deepEqual(m.get('c').map(x => x.id), ['a', 'b'])
})

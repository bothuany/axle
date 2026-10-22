// The agent's gaze: tool events become a file and lines, never content or search text, and are throttled per session (src/gaze.ts).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let g
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-gaze-'))
	const outfile = join(tmp, 'gaze.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'gaze.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	g = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const ws = resolve('/ws/shop')
const roots = [ws]
const at = (...p) => join(ws, ...p)

test('Read: offset and limit are the lines; the response may say what it returned; a whole-file read has none', () => {
	assert.deepEqual(g.looksFromHook('Read', { file_path: at('src', 'a.ts'), offset: 40, limit: 20 }, {}, ws, roots), [{ act: 'read', file: at('src', 'a.ts'), startLine: 40, endLine: 59 }])
	assert.deepEqual(g.looksFromHook('Read', { file_path: at('a.ts') }, { type: 'text', file: { filePath: at('a.ts'), content: 'x', numLines: 30, startLine: 1, totalLines: 900 } }, ws, roots), [{ act: 'read', file: at('a.ts'), startLine: 1, endLine: 30 }])
	assert.deepEqual(g.looksFromHook('Read', { file_path: at('a.ts') }, { type: 'text', file: { content: 'x', numLines: 90, startLine: 1, totalLines: 90 } }, ws, roots), [{ act: 'read', file: at('a.ts') }])
	assert.deepEqual(g.looksFromHook('Read', { file_path: at('a.ts') }, {}, ws, roots), [{ act: 'read', file: at('a.ts') }])
})

test('Edit: the changed lines of its structured patch, context lines left out; Write is the whole file', () => {
	const response = { filePath: at('a.ts'), oldString: 'secret old', newString: 'secret new', structuredPatch: [{ oldStart: 10, oldLines: 7, newStart: 10, newLines: 8, lines: [' a', ' b', ' c', '-old', '+new', '+new2', ' d', ' e', ' f'] }] }
	assert.deepEqual(g.looksFromHook('Edit', { file_path: at('a.ts'), old_string: 'secret old' }, response, ws, roots), [{ act: 'edit', file: at('a.ts'), startLine: 13, endLine: 14 }])
	assert.deepEqual(g.looksFromHook('Edit', { file_path: at('a.ts') }, {}, ws, roots), [{ act: 'edit', file: at('a.ts') }])
	assert.deepEqual(g.looksFromHook('Write', { file_path: at('b.ts'), content: 'everything' }, {}, ws, roots), [{ act: 'edit', file: at('b.ts') }])
})

test('Grep and Glob: the folder only, never the pattern; Bash, web and MCP tools are not gaze', () => {
	const grep = g.looksFromHook('Grep', { pattern: 's3cret', path: at('src'), glob: '*.secretglob', type: 'ts' }, { content: 'hit s3cret' }, ws, roots)
	assert.deepEqual(grep, [{ act: 'search', file: at('src') }])
	assert.deepEqual(g.looksFromHook('Glob', { pattern: '**/*.s3cret' }, {}, ws, roots), [{ act: 'search', file: ws }], 'no path: the folder it runs in')
	const none = [
		g.looksFromHook('Bash', { command: 'cat s3cret.txt' }, { stdout: 's3cret' }, ws, roots),
		g.looksFromHook('WebFetch', { url: 'https://example.com/s3cret' }, {}, ws, roots),
		g.looksFromHook('mcp__insilode__open', { file: at('a.ts') }, {}, ws, roots),
	]
	assert.deepEqual(none, [[], [], []])
	assert.ok(!JSON.stringify([grep, none]).includes('s3cret'), 'no search text or command leaves the normaliser')
})

test('only workspace files: outside, node_modules, .git, out and .claude are dropped; relative paths resolve against cwd', () => {
	const read = f => g.looksFromHook('Read', { file_path: f }, {}, ws, roots)
	assert.deepEqual(read(resolve('/elsewhere/x.ts')), [])
	assert.deepEqual(read(join(ws, '..', 'other', 'x.ts')), [])
	assert.deepEqual(read(at('node_modules', 'lib', 'x.js')), [])
	assert.deepEqual(read(at('.git', 'HEAD')), [])
	assert.deepEqual(read(at('out', 'main.js')), [])
	assert.deepEqual(read(at('.claude', 'settings.json')), [])
	assert.deepEqual(read(at('src', 'layout.ts')), [{ act: 'read', file: at('src', 'layout.ts') }], 'a name that merely contains "out" stays')
	assert.deepEqual(read(join('src', 'a.ts')), [{ act: 'read', file: at('src', 'a.ts') }])
})

test('Codex apply_patch: the files of the patch, never its text', () => {
	const command = ['apply_patch', '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-s3cret\n+other\n*** Add File: src/b.ts\n+new\n*** End Patch\n']
	const looks = g.looksFromHook('apply_patch', { command }, {}, ws, roots)
	assert.deepEqual(looks.map(l => l.file).sort(), [at('src', 'a.ts'), at('src', 'b.ts')])
	assert.ok(looks.every(l => l.act === 'edit'))
	assert.ok(!JSON.stringify(looks).includes('s3cret'))
})

test('ACP: kind and locations, never the title; execute and fetch are not gaze', () => {
	assert.deepEqual(g.looksFromAcp('read', [{ path: at('a.ts'), line: 12 }], roots), [{ act: 'read', file: at('a.ts'), startLine: 12 }])
	assert.deepEqual(g.looksFromAcp('edit', [{ path: at('a.ts') }, { path: resolve('/etc/passwd') }], roots), [{ act: 'edit', file: at('a.ts') }])
	assert.deepEqual(g.looksFromAcp('search', [{ path: at('src'), line: 3 }], roots), [{ act: 'search', file: at('src') }])
	assert.deepEqual(g.looksFromAcp('execute', [{ path: at('a.ts') }], roots), [])
	assert.deepEqual(g.looksFromAcp('read', [{ path: 'relative.ts' }], roots), [], 'ACP paths are absolute')
	assert.deepEqual(g.looksFromAcp(undefined, null, roots), [])
})

// ---- throttle --------------------------------------------------------------------------------------------

function clock() {
	let now = 1000
	const timers = []
	return {
		now: () => now,
		later: (fn, ms) => { const t = { fn, due: now + ms }; timers.push(t); return t },
		cancel: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) },
		advance(ms) {
			now += ms
			for (const t of timers.filter(t => t.due <= now)) { timers.splice(timers.indexOf(t), 1); t.fn() }
		},
	}
}
const who = (session = 's1') => ({ session, agent: 'Claude Code', color: '#ff9d7d', turn: 1 })

test('looks at one file within 300 ms become one, their lines joined; far ranges and other files stay apart', () => {
	const c = clock()
	const sent = []
	const q = new g.GazeQueue(b => sent.push(b), c.now, c.later, c.cancel)
	q.push(who(), [{ act: 'read', file: at('a.ts'), startLine: 1, endLine: 50 }])
	c.advance(100)
	q.push(who(), [{ act: 'read', file: at('a.ts'), startLine: 51, endLine: 100 }])
	q.push(who(), [{ act: 'read', file: at('a.ts'), startLine: 900, endLine: 950 }])
	q.push(who(), [{ act: 'read', file: at('b.ts') }])
	q.push(who('s2'), [{ act: 'read', file: at('a.ts'), startLine: 60 }])
	c.advance(1000)
	assert.equal(sent.length, 1)
	assert.deepEqual(sent[0].looks.map(l => [l.session, l.file.slice(ws.length + 1), l.startLine, l.endLine]), [
		['s1', 'a.ts', 1, 100], ['s1', 'a.ts', 900, 950], ['s1', 'b.ts', undefined, undefined], ['s2', 'a.ts', 60, undefined],
	])
	assert.equal(sent[0].burst, undefined)
	assert.equal(sent[0].looks[0].turn, 1)
})

test('at most four batches a second, and more than 20 looks in a second is a burst', () => {
	const c = clock()
	const sent = []
	const q = new g.GazeQueue(b => sent.push({ at: c.now(), ...b }), c.now, c.later, c.cancel)
	for (let i = 0; i < 40; i++) {
		q.push(who(), [{ act: 'read', file: at(`f${i}.ts`) }])
		c.advance(25)
	}
	c.advance(1000)
	const gaps = sent.slice(1).map((b, i) => b.at - sent[i].at)
	assert.ok(gaps.every(d => d >= g.BATCH_MS), `batches ${g.BATCH_MS} ms apart at least: ${gaps}`)
	assert.equal(sent.flatMap(b => b.looks).length, 40, 'nothing is lost')
	assert.ok(sent.some(b => b.burst), 'a burst is marked')
})

test('an edit and a read of one file stay two looks', () => {
	const c = clock()
	const sent = []
	const q = new g.GazeQueue(b => sent.push(b), c.now, c.later, c.cancel)
	q.push(who(), [{ act: 'read', file: at('a.ts'), startLine: 5 }])
	q.push(who(), [{ act: 'edit', file: at('a.ts'), startLine: 6 }])
	q.flush()
	assert.deepEqual(sent[0].looks.map(l => l.act), ['read', 'edit'])
})

// A tour file (src/tour/validate.ts): turned into the Tour the canvas plays, with its limits, its plain-text captions and
// its paths kept inside the workspace. Pure, so it is bundled with esbuild and run under plain Node, like messages.test.mjs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './helpers.mjs'

let v
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-tour-file-'))
	const outfile = join(tmp, 'validate.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'tour', 'validate.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	v = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const work = resolve(tmpdir(), 'axle-tour-work')
/** A workspace of two files, read from a table. */
const files = new Map([
	[join(work, 'src', 'a.js'), Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')],
	[join(work, 'b.py'), 'def f():\r\n    return 1\r\n'],
])
const host = { roots: [work], readText: f => files.get(f) }
const file = (extra = {}) => ({ axleTour: 1, id: 't1', title: 'A tour', steps: [{ caption: 'Hello' }], ...extra })
const parse = (raw, h = host) => v.parseTourFile(raw, h)
const fails = (raw, pattern, h = host) => assert.throws(() => parse(raw, h), e => e instanceof v.TourFileError && pattern.test(e.message), String(pattern))

test('a minimal tour: its steps keep their order, the first step is the default, and the source is a file', () => {
	const { tour, flow } = parse(file({ steps: [{ caption: 'one' }, { caption: 'two', title: 'Second' }] }))
	assert.deepEqual(tour.steps.map(s => [s.title, s.caption, s.state]), [['Step 1', 'one', 'ok'], ['Second', 'two', 'ok']])
	assert.deepEqual([tour.id, tour.title, tour.source, tour.origin, tour.start], ['t1', 'A tour', 'file', 'Tour file', 0])
	assert.equal(flow, undefined)
	assert.equal(tour.steps[0].at, undefined, 'a step with only a caption points at nothing')
})

test('a step is placed by its line: current-file lines, an absolute path, highlights and a peek of its code', () => {
	const { tour } = parse(file({ steps: [{ caption: 'c', file: 'src/a.js', line: 10, lines: [[12, 14]], method: 'Order.place' }] }))
	const s = tour.steps[0]
	assert.equal(s.state, 'ok')
	assert.deepEqual(s.at, { file: join(work, 'src', 'a.js'), startLine: 10, endLine: 14, label: 'Order.place' })
	assert.deepEqual(s.highlights, [[12, 14]])
	assert.equal(s.peek.startLine, 8, 'two lines of context before it')
	assert.match(s.peek.code, /^line 8\nline 9\nline 10/)
	assert.match(s.peek.code, /line 22$/, 'at least a dozen lines after the start, so a method is not cut after its signature')
})

test('a peek is at most 40 lines, and reads CRLF text', () => {
	const big = parse(file({ steps: [{ caption: 'c', file: 'src/a.js', line: 2, lines: [[2, 60]] }] })).tour.steps[0]
	assert.equal(big.peek.code.split('\n').length, 40)
	const py = parse(file({ steps: [{ caption: 'c', file: 'b.py', line: 1 }] })).tour.steps[0]
	assert.equal(py.peek.code.includes('\r'), false)
	assert.deepEqual(py.at.label, 'b.py:1')
})

test('a step with only `lines` starts at the first of them', () => {
	const s = parse(file({ steps: [{ caption: 'c', file: 'src/a.js', lines: [[20, 21], [5, 6]] }] })).tour.steps[0]
	assert.deepEqual([s.at.startLine, s.at.endLine], [20, 21])
})

test('a step that cannot be placed is missing, shown with its caption, and never points at a wrong card', () => {
	const steps = parse(file({ steps: [
		{ caption: 'no line', file: 'src/a.js', method: 'Order.place' },
		{ caption: 'no such file', file: 'src/gone.js', line: 3 },
		{ caption: 'out', file: '../../etc/passwd', line: 1 },
		{ caption: 'elsewhere', file: process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd', line: 1 },
	] })).tour.steps
	assert.deepEqual(steps.map(s => s.state), ['missing', 'missing', 'missing', 'missing'])
	assert.ok(steps.every(s => s.caption && !s.peek), 'the caption stays, no code is read')
	assert.equal(steps[2].at.file, '', 'a path outside the workspace is not even kept')
})

test('a table step names a database card', () => {
	const s = parse(file({ steps: [{ caption: 'c', table: 'orders' }] })).tour.steps[0]
	assert.deepEqual(s.at, { file: '', startLine: 0, endLine: 0, label: 'orders', table: 'orders' })
})

test('highlights: three ranges, each at most 80 lines, bad ones dropped, a lone number is a one-line range', () => {
	const s = parse(file({ steps: [{ caption: 'c', file: 'src/a.js', line: 1, lines: [[1, 500], [0, 3], ['x'], [9], [10, 11], [12, 13], [14, 15]] }] })).tour.steps[0]
	assert.deepEqual(s.highlights, [[1, 80], [9, 9], [10, 11]])
})

test('captions are Markdown text: control characters go, line breaks and backticks stay', () => {
	const s = parse(file({ steps: [{ caption: 'a\tb\n\n\n\n- c\u0007`d`\u0000\r\n  x  \n', title: 'T\u001b[31m' }] })).tour.steps[0]
	assert.equal(s.caption, 'a b\n\n- c `d`\n  x')
	assert.equal(s.title, 'T [31m')
	assert.equal(parse(file({ steps: [{ caption: '<img src=x onerror=1>' }] })).tour.steps[0].caption, '<img src=x onerror=1>', 'markup is left as text: the canvas never renders it as HTML')
})

test('limits name the bad field: 31 steps, a long caption, a long title, no caption', () => {
	fails(file({ steps: Array.from({ length: 31 }, () => ({ caption: 'x' })) }), /31 steps.*at most 30/)
	assert.equal(parse(file({ steps: Array.from({ length: 30 }, () => ({ caption: 'x' })) })).tour.steps.length, 30)
	fails(file({ steps: [{ caption: 'x'.repeat(601) }] }), /steps\[0\]\.caption is 601 characters.*at most 600/)
	assert.ok(parse(file({ steps: [{ caption: 'x'.repeat(600) }] })))
	fails(file({ steps: [{ caption: 'x', title: 'y'.repeat(81) }] }), /steps\[0\]\.title/)
	fails(file({ title: 'y'.repeat(121) }), /"title"/)
	fails(file({ steps: [{ title: 'only a title' }] }), /steps\[0\]\.caption is missing/)
	fails(file({ steps: [] }), /"steps" must list at least one/)
	fails(file({ steps: ['text'] }), /steps\[0\] is not an object/)
})

test('the header: a version, an id that is a plain name, a title', () => {
	fails({ ...file(), axleTour: 2 }, /"axleTour": 1 is missing/)
	fails({ ...file(), axleTour: undefined }, /"axleTour": 1 is missing/)
	fails(file({ id: '../x' }), /"id"/)
	fails(file({ id: '' }), /"id"/)
	fails(file({ title: '' }), /"title" is missing/)
	fails([], /JSON object/)
	fails('tour', /JSON object/)
})

test('fields that are not part of the format are dropped: a tour has no commands and no URIs', () => {
	const raw = file({
		commands: ['workbench.action.terminal.new'],
		uri: 'https://example.com',
		steps: [{ caption: 'c', commands: ['x'], uri: 'file:///etc/passwd', command: 'flow.pickSolution', file: 'src/a.js', line: 3, html: '<b>', onClick: 'x' }],
	})
	const { tour } = parse(raw)
	assert.deepEqual(Object.keys(tour).sort(), ['id', 'origin', 'source', 'start', 'steps', 'title'])
	assert.deepEqual(Object.keys(tour.steps[0]).sort(), ['at', 'caption', 'peek', 'state', 'title'])
	assert.equal(JSON.stringify(tour).includes('passwd'), false)
})

test('start is 1-based in the file, 0-based on the wire, and kept inside the steps', () => {
	const steps = [{ caption: 'a' }, { caption: 'b' }, { caption: 'c' }]
	assert.equal(parse(file({ steps, start: 2 })).tour.start, 1)
	assert.equal(parse(file({ steps, start: 99 })).tour.start, 2)
	assert.equal(parse(file({ steps, start: 0 })).tour.start, 0)
	assert.equal(parse(file({ steps })).tour.start, 0)
})

test('the agent: a label and a colour that is a colour, else a plain pointer', () => {
	assert.deepEqual(parse(file({ agent: { label: 'Claude Code', color: '#ff9d7d' } })).tour.agent, { label: 'Claude Code', color: '#ff9d7d' })
	assert.equal(parse(file({ agent: { label: 'x', color: 'red; background:url(//evil)' } })).tour.agent, undefined)
	assert.equal(parse(file({ agent: { color: '#fff' } })).tour.agent, undefined)
	assert.equal(parse(file({ author: 'Me' })).tour.origin, 'Me')
})

test('flow: an endpoint, an id, a file inside the workspace; one outside is refused', () => {
	assert.deepEqual(parse(file({ flow: { http: ' POST /api/orders ' } })).flow, { http: 'POST /api/orders' })
	assert.deepEqual(parse(file({ flow: { id: 'a.js#f@1' } })).flow, { id: 'a.js#f@1' })
	assert.deepEqual(parse(file({ flow: { file: 'src/a.js', line: 7 } })).flow, { file: join(work, 'src', 'a.js'), line: 7 })
	assert.deepEqual(parse(file({ flow: { changes: true } })).flow, { changes: true })
	assert.equal(parse(file({ flow: {} })).flow, undefined)
	fails(file({ flow: { file: '../secret.txt' } }), /flow\.file.*not inside the workspace/)
})

test('insideWorkspace: a name with a line break or a control character is no file (it would end up in a terminal prompt)', () => {
	const roots = [join(work, 'proj')]
	for (const code of [10, 13, 27, 3, 4, 0x85]) assert.equal(v.insideWorkspace(roots, `a${String.fromCharCode(code)}b.cs`), undefined, String(code))
	assert.equal(v.insideWorkspace(roots, 'a b.cs'), join(work, 'proj', 'a b.cs'), 'a space is a name')
})

test('insideWorkspace: relative paths inside a root, nothing that leaves it', () => {
	const roots = [join(work, 'proj')]
	assert.equal(v.insideWorkspace(roots, 'a/b.js'), join(work, 'proj', 'a', 'b.js'))
	assert.equal(v.insideWorkspace(roots, join(work, 'proj', 'x.js')), join(work, 'proj', 'x.js'), 'an absolute path inside the root')
	assert.equal(v.insideWorkspace(roots, '../proj/x.js'), join(work, 'proj', 'x.js'), 'a detour that comes back is fine')
	assert.equal(v.insideWorkspace(roots, '..'), undefined)
	assert.equal(v.insideWorkspace(roots, '../other/x.js'), undefined)
	assert.equal(v.insideWorkspace(roots, join(work, 'proj-evil', 'x.js')), undefined, 'a sibling that merely starts with the same name')
	assert.equal(v.insideWorkspace(roots, '.'), undefined, 'the root itself is not a file')
	assert.equal(v.insideWorkspace([join(work, 'a'), join(work, 'proj')], 'x.js'), join(work, 'a', 'x.js'), 'the first root that holds it')
})

// ---- the sample tour, against the demo project of the probe skill ------------------------------------------------------

const demoScript = resolve(ROOT, '..', '..', '..', '.claude', 'skills', 'probe', 'scripts', 'demo-workspace.mjs')
const sample = join(ROOT, 'test', 'tour-fixtures', 'demo-shop-orders.tour.json')

test('the sample tour lines up with the demo project: each step lands on the code its caption is about', { skip: !existsSync(demoScript) && 'the probe skill is not in this checkout' }, () => {
	const demo = join(tmp, 'demo-shop')
	execFileSync(process.execPath, [demoScript, demo], { stdio: 'ignore' })
	const real = { roots: [demo], readText: f => (existsSync(f) ? readFileSync(f, 'utf8') : undefined) }
	const { tour, flow } = parse(JSON.parse(readFileSync(sample, 'utf8')), real)
	assert.deepEqual(flow, { http: 'POST /api/orders' })
	assert.equal(tour.steps.length, 6)
	assert.deepEqual(tour.steps.map(s => s.state), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
	const textAt = (s, n = s.at.startLine) => readFileSync(s.at.file, 'utf8').split(/\r?\n/)[n - 1]
	const [intro, browser, handler, store, billing, outro] = tour.steps
	assert.equal(intro.at, undefined)
	assert.equal(outro.at, undefined)
	assert.match(textAt(browser, browser.highlights[0][0]), /axios\.post\('\/api\/orders'/)
	assert.match(textAt(handler), /function createOrder/)
	assert.match(textAt(handler, handler.highlights[0][0]), /repo\.insert/)
	assert.match(textAt(store), /function insert/)
	assert.match(textAt(billing), /def create_invoice/)
	assert.match(textAt(billing, billing.highlights[0][0]), /requests\.get/)
	assert.equal(tour.agent.label, 'Claude Code')
})

test('the sample is valid JSON that this file format accepts without a workspace to read', () => {
	const noFiles = { roots: [join(tmp, 'nowhere')], readText: () => undefined }
	const { tour } = parse(JSON.parse(readFileSync(sample, 'utf8')), noFiles)
	assert.equal(tour.steps.filter(s => s.state === 'missing').length, 4, 'with no code to read, only the file-less steps stay ok')
})

test('what the canvas reports is accepted only for the tour the host sent', () => {
	const playing = { id: 't1', steps: 3 }
	assert.deepEqual(v.tourReport(playing, { type: 'tourState', id: 't1', index: 2, paused: true }), { exit: false, index: 2, paused: true })
	assert.deepEqual(v.tourReport(playing, { type: 'tourState', id: 't1', index: 0 }), { exit: false, index: 0, paused: false })
	assert.deepEqual(v.tourReport(playing, { type: 'tourExit', id: 't1' }), { exit: true })
	assert.equal(v.tourReport(playing, { type: 'tourState', id: 'other', index: 1, paused: false }), undefined, 'an id the host never sent')
	assert.equal(v.tourReport(undefined, { type: 'tourState', id: 't1', index: 1, paused: false }), undefined, 'no tour is playing')
	for (const index of [3, -1, 1.5, '1', null, undefined]) assert.equal(v.tourReport(playing, { type: 'tourState', id: 't1', index }), undefined, `index ${index}`)
	assert.equal(v.tourReport(playing, { type: 'tourAsk', id: 't1', index: 1 }), undefined, 'only the two reports of phase 0')
	assert.equal(v.tourReport(playing, null), undefined)
})

test('a peek is cut to a few KB with short lines, and a file named by several steps is read once', () => {
	let reads = 0
	const long = new Map([[join(work, 'src', 'bundle.js'), `${'x'.repeat(5000)}\n`.repeat(60)]])
	const h = { roots: [work], readText: f => { reads++; return long.get(f) } }
	const steps = Array.from({ length: 5 }, () => ({ caption: 'c', file: 'src/bundle.js', line: 2 }))
	const { tour } = parse(file({ steps }), h)
	assert.equal(reads, 1)
	const peek = tour.steps[0].peek
	assert.ok(peek.code.length <= 8000, `${peek.code.length} characters`)
	assert.ok(peek.code.split('\n').every(l => l.length <= 300))
})

// ---- reading the code of a step (src/tour/files.ts): real files inside the workspace only -------------------------------

let files_
before(async () => {
	const outfile = join(tmp, 'files.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'tour', 'files.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	files_ = await import(pathToFileURL(outfile).href)
})

test('a path is judged by the real file behind it: a symlink out of the workspace is not read, a directory is not a file', t => {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'flow-tour-real-')))
	const ws = join(root, 'ws')
	mkdirSync(join(ws, 'src'), { recursive: true })
	writeFileSync(join(ws, 'src', 'a.js'), 'one\ntwo\n')
	writeFileSync(join(root, 'secret.txt'), 'top secret\n')
	t.after(() => rmSync(root, { recursive: true, force: true }))
	const read = files_.readTextIn([ws])
	assert.equal(read(join(ws, 'src', 'a.js')), 'one\ntwo\n')
	assert.equal(read(join(ws, 'src', 'gone.js')), undefined, 'a file that is not there')
	assert.equal(read(join(ws, 'src')), undefined, 'a directory')
	assert.equal(read(join(root, 'secret.txt')), undefined, 'a file next to the workspace')
	assert.equal(files_.realInside([ws], join(ws, 'src', '..', 'src', 'a.js')), join(ws, 'src', 'a.js'))
	try {
		symlinkSync(join(root, 'secret.txt'), join(ws, 'src', 'link.txt'))
	} catch (e) {
		t.diagnostic(`no symlinks here (${e.code}): that case is not run`)
		return
	}
	assert.equal(files_.realInside([ws], join(ws, 'src', 'link.txt')), undefined, 'the symlink points out of the workspace')
	assert.equal(read(join(ws, 'src', 'link.txt')), undefined, 'so what is behind it is not read')
})

test('a big file is read only at its start', t => {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'flow-tour-big-')))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	writeFileSync(join(root, 'big.js'), 'y'.repeat(2_000_000))
	assert.equal(files_.readTextIn([root])(join(root, 'big.js')).length, files_.PEEK_READ_BYTES)
})

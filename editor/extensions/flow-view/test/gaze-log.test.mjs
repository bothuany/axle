// The agent's gaze on the host (src/tour/gaze.ts): the looks flow-agent sends are checked, kept in memory per session, and a
// session's latest turn replays as a tour. Pure, so it is bundled with esbuild and run under plain Node.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './helpers.mjs'

let g
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-gaze-'))
	const outfile = join(tmp, 'gaze.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'tour', 'gaze.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	g = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const work = resolve(tmpdir(), 'axle-gaze-work')
const roots = [work]
const at = (...p) => join(work, ...p)
const look = (extra = {}) => ({ session: 's1', agent: 'Claude Code (terminal)', color: '#ff9d7d', act: 'read', file: at('src', 'a.js'), startLine: 10, endLine: 20, turn: 1, at: 1000, ...extra })
const parse = (...looks) => g.parseGaze({ looks }, roots)

test('a look becomes a GazeEvent: a file and lines, the agent\'s name and colour, nothing else', () => {
	const [k] = parse({ ...look(), content: 'secret', pattern: 'secret' })
	assert.deepEqual(k, { turn: 1, event: { session: 's1', agent: { label: 'Claude Code (terminal)', color: '#ff9d7d' }, act: 'read', file: at('src', 'a.js'), startLine: 10, endLine: 20, at: 1000 } })
})

test('looks that do not hold up are dropped', () => {
	assert.deepEqual(parse(
		look({ file: resolve('/etc/passwd') }),
		look({ file: join(work, '..', 'x.js') }),
		look({ file: 'src/a.js' }),
		look({ act: 'run' }),
		look({ session: '' }),
		look({ session: 42 }),
		'nope',
	), [])
	assert.deepEqual(g.parseGaze(null, roots), [])
	assert.deepEqual(g.parseGaze({ looks: 'x' }, roots), [])
})

test('labels are cut and cleaned, a colour that is not a hex literal is replaced, bad lines are left out', () => {
	const [k] = parse(look({ agent: 'A\u0007gent '.repeat(20), color: 'red;background:url(x)', startLine: 0, endLine: 5 }))
	assert.equal(k.event.agent.label.length, 40)
	assert.ok(!/[\u0000-\u001f]/.test(k.event.agent.label))
	assert.equal(k.event.agent.color, '#c6a8ff')
	assert.equal(k.event.startLine, undefined)
	assert.equal(parse(look({ startLine: 30, endLine: 5 }))[0].event.endLine, undefined, 'an end before the start is dropped')
	assert.equal(parse(look({ startLine: 2.5 }))[0].event.startLine, undefined)
})

test('a search names a folder, maybe the workspace folder itself, and never has lines', () => {
	const [a, b] = parse(look({ act: 'search', file: at('src'), startLine: 3 }), look({ act: 'search', file: work }))
	assert.deepEqual([a.event.file, a.event.startLine, b.event.file], [at('src'), undefined, work])
	assert.deepEqual(parse(look({ act: 'read', file: work })), [], 'only a search may name the folder itself')
})

test('the log keeps the last 300 per session, the recent minute for a new canvas, and the latest turn for a replay', () => {
	const log = new g.GazeLog()
	const many = Array.from({ length: 310 }, (_, i) => look({ at: i, startLine: i + 1, endLine: i + 1 }))
	assert.equal(parse(...many).length, 200, 'one batch carries 200 looks at most')
	log.add(parse(...many.slice(0, 155)))
	log.add(parse(...many.slice(155)))
	log.add(parse(look({ session: 's2', at: 100_000 }), look({ session: 's2', turn: 2, at: 100_500, startLine: 40 }), look({ session: 's2', turn: 2, at: 100_600, startLine: 41 })))
	assert.ok(log.has('s1') && log.has('s2') && !log.has('s3') && !log.has(undefined))
	assert.equal(log.recent(100_700).length, 3, 's1 is older than a minute')
	assert.equal(log.recent(400, 1000).filter(e => e.session === 's1').length, 300, 'the oldest ten of s1 were dropped')
	assert.deepEqual(log.lastTurn('s2').map(e => e.startLine), [40, 41])
	log.clear('s2')
	assert.ok(!log.has('s2'))
})

test('replay: consecutive looks at one place merge, an edit and a search get their own captions, the agent colours the cursor', () => {
	const text = Array.from({ length: 80 }, (_, i) => `code ${i + 1}`).join('\n')
	const events = [
		look({ startLine: 10, endLine: 20 }), look({ startLine: 15, endLine: 30 }),
		look({ act: 'search', file: at('src'), startLine: undefined, endLine: undefined }),
		look({ act: 'edit', startLine: 12, endLine: 13 }),
		look({ file: at('b.js'), startLine: undefined, endLine: undefined }),
	].map(l => parse(l)[0].event)
	const tour = g.gazeTour(events, roots, f => f === at('src', 'a.js') ? text : undefined)
	assert.equal(tour.source, 'gaze')
	assert.deepEqual(tour.agent, { label: 'Claude Code (terminal)', color: '#ff9d7d' })
	assert.deepEqual(tour.steps.map(s => [s.title, s.caption, s.state]), [
		['Read a.js ×2', 'Read ×2: lines 10–30 of a.js.', 'ok'],
		['Searched in src', 'Searched in src.', 'ok'],
		['Edited a.js', 'Edited: lines 12–13 of a.js.', 'ok'],
		['Read b.js', 'Read: all of b.js.', 'ok'],
	])
	assert.deepEqual(tour.steps[0].at, { file: at('src', 'a.js'), startLine: 10, endLine: 30, label: 'a.js' })
	assert.deepEqual(tour.steps[0].highlights, [[10, 30]])
	assert.equal(tour.steps[1].at, undefined, 'a search points at nothing')
	assert.ok(tour.steps[0].peek?.code.includes('code 10'), 'a step off the drawn flow can show its code')
	assert.equal(tour.steps[3].peek, undefined, 'no text, no peek: the caption alone')
	assert.equal(g.gazeTour([], roots, () => undefined), undefined)
})

test('replay: a trail longer than a tour keeps its last steps behind a note', () => {
	const events = Array.from({ length: 50 }, (_, i) => parse(look({ file: at(`f${i}.js`) }))[0].event)
	const tour = g.gazeTour(events, roots, () => undefined)
	assert.equal(tour.steps.length, 30)
	assert.match(tour.steps[0].caption, /21 earlier places left out/)
	assert.equal(tour.steps.at(-1).title, 'Read f49.js')
})

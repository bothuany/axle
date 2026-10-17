// Where a question for "the agent" goes: the picker's order, what is remembered, the fallbacks and the setting (src/askTarget.ts).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let a
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-asktarget-'))
	const outfile = join(tmp, 'askTarget.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'askTarget.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	a = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const s = (id, cli, state, since, more = {}) => ({ id, cli, name: id, state, since, heard: true, alive: true, ...more })
const GEMINI = { name: 'Gemini', command: 'gemini', acceptsInput: true }
const AIDER = { name: 'Aider', command: 'aider' }
const base = { customs: [GEMINI, AIDER], chat: true, canStart: true }

test('only sessions at their prompt are typed into', () => {
	const c = [GEMINI, AIDER]
	assert.equal(a.canType(s('a', 'claude', 'idle', 1), c), true)
	assert.equal(a.canType(s('a', 'codex', 'done', 1), c), true)
	for (const state of ['working', 'blocked', 'starting', 'unknown', 'ended']) {
		assert.equal(a.canType(s('a', 'claude', state, 1), c), false, state)
	}
	assert.equal(a.canType(s('a', 'claude', 'idle', 1, { heard: false }), c), false, 'no hook yet: could be the trust screen')
	assert.equal(a.canType(s('a', 'claude', 'idle', 1, { alive: false }), c), false, 'terminal gone')
	assert.equal(a.canType(s('g', 'custom', 'unknown', 1, { command: 'gemini', heard: false }), c), true, 'custom marked as taking input')
	assert.equal(a.canType(s('x', 'custom', 'unknown', 1, { command: 'aider', heard: false }), c), false, 'custom not marked')
})

test('picker order: ready sessions newest first, then new sessions, chat, clipboard', () => {
	const sessions = [
		s('old', 'claude', 'done', 1),
		s('busy', 'claude', 'working', 9),
		s('ask', 'codex', 'blocked', 8),
		s('cx', 'codex', 'idle', 5),
		s('gem', 'custom', 'unknown', 7, { command: 'gemini', heard: false }),
		s('aid', 'custom', 'unknown', 6, { command: 'aider', heard: false }),
	]
	const labels = a.choices({ ...base, sessions }).map(c => c.label)
	assert.deepEqual(labels, ['cx', 'old', 'gem', 'New Claude Code session', 'New Codex session', 'New Gemini session', 'Chat panel', 'Copy to clipboard'])
	const first = a.choices({ ...base, sessions })[0]
	assert.equal(first.description, 'Codex · ready')
})

test('no new sessions where agents cannot start, no chat without a provider', () => {
	const labels = a.choices({ ...base, sessions: [], chat: false, canStart: false }).map(c => c.label)
	assert.deepEqual(labels, ['Copy to clipboard'])
})

test('setting: ask always asks; remember with nothing remembered asks', () => {
	assert.deepEqual(a.resolve({ ...base, setting: 'ask', remembered: { kind: 'clipboard' }, sessions: [] }), { pick: true })
	assert.deepEqual(a.resolve({ ...base, setting: 'remember', sessions: [] }), { pick: true })
})

test('a remembered ready session is used without asking', () => {
	const r = a.resolve({ ...base, setting: 'remember', remembered: { kind: 'session', id: 'cx', cli: 'codex' }, sessions: [s('cx', 'codex', 'done', 1), s('cl', 'claude', 'idle', 2)] })
	assert.deepEqual(r, { use: { kind: 'session', id: 'cx', cli: 'codex' } })
})

test('a remembered session that is busy or waiting on a prompt is not typed into', () => {
	const busy = a.resolve({ ...base, setting: 'remember', remembered: { kind: 'session', id: 'cx', cli: 'codex' }, sessions: [s('cx', 'codex', 'working', 1)] })
	assert.equal(busy.pick, true)
	assert.match(busy.why, /busy/)
	const blocked = a.resolve({ ...base, setting: 'remember', remembered: { kind: 'session', id: 'cx', cli: 'codex' }, sessions: [s('cx', 'codex', 'blocked', 1)] })
	assert.equal(blocked.pick, true)
	assert.match(blocked.why, /waiting for you/)
	const silent = a.resolve({ ...base, setting: 'remember', remembered: { kind: 'session', id: 'cx', cli: 'codex' }, sessions: [s('cx', 'codex', 'unknown', 1, { heard: false })] })
	assert.equal(silent.pick, true)
	assert.doesNotMatch(silent.why, /busy/, 'a Codex with untrusted hooks is not busy')
	assert.match(silent.why, /\/hooks/)
	assert.match(a.notReady({ name: 'Claude', cli: 'claude', state: 'starting' }), /not said it is at its prompt yet/)
})

test('a remembered session that closed falls back to its CLI: another ready session, else a new one', () => {
	const remembered = { kind: 'session', id: 'gone', cli: 'codex' }
	const other = a.resolve({ ...base, setting: 'remember', remembered, sessions: [s('cx2', 'codex', 'idle', 3), s('cl', 'claude', 'idle', 4)] })
	assert.deepEqual(other.use, { kind: 'session', id: 'cx2', cli: 'codex', custom: undefined })
	const fresh = a.resolve({ ...base, setting: 'remember', remembered, sessions: [s('cl', 'claude', 'idle', 4)] })
	assert.deepEqual(fresh.use, { kind: 'new', cli: 'codex', custom: undefined })
	assert.match(fresh.why, /closed/)
	const noStart = a.resolve({ ...base, canStart: false, setting: 'remember', remembered, sessions: [] })
	assert.equal(noStart.pick, true)
})

test('a remembered custom CLI removed from the settings asks again', () => {
	const r = a.resolve({ ...base, setting: 'remember', remembered: { kind: 'new', cli: 'custom', custom: 'Gone' }, sessions: [] })
	assert.equal(r.pick, true)
	const notInput = a.resolve({ ...base, setting: 'remember', remembered: { kind: 'new', cli: 'custom', custom: 'Aider' }, sessions: [] })
	assert.equal(notInput.pick, true)
	const ok = a.resolve({ ...base, setting: 'remember', remembered: { kind: 'new', cli: 'custom', custom: 'Gemini' }, sessions: [] })
	assert.deepEqual(ok.use, { kind: 'new', cli: 'custom', custom: 'Gemini' })
})

test('a fixed kind uses that CLI: a ready session of it, else a new one; never another CLI', () => {
	const sessions = [s('cl', 'claude', 'idle', 9), s('cx', 'codex', 'working', 8)]
	assert.deepEqual(a.resolve({ ...base, setting: 'codex', remembered: { kind: 'session', id: 'cl', cli: 'claude' }, sessions }).use, { kind: 'new', cli: 'codex', custom: undefined })
	assert.deepEqual(a.resolve({ ...base, setting: 'claude', sessions }).use, { kind: 'session', id: 'cl', cli: 'claude', custom: undefined })
	const gem = a.resolve({ ...base, setting: 'custom:Gemini', sessions: [s('g', 'custom', 'unknown', 1, { command: 'gemini', heard: false })] })
	assert.deepEqual(gem.use, { kind: 'session', id: 'g', cli: 'custom', custom: 'Gemini' })
})

test('chat and clipboard: chat asks again when no provider is there', () => {
	assert.deepEqual(a.resolve({ ...base, setting: 'clipboard', sessions: [] }), { use: { kind: 'clipboard' } })
	assert.deepEqual(a.resolve({ ...base, setting: 'chat', sessions: [] }), { use: { kind: 'chat' } })
	assert.equal(a.resolve({ ...base, chat: false, setting: 'remember', remembered: { kind: 'chat' }, sessions: [] }).pick, true)
})

test('parseSetting falls back to remember for anything unknown', () => {
	assert.equal(a.parseSetting(undefined), 'remember')
	assert.equal(a.parseSetting('nonsense'), 'remember')
	assert.equal(a.parseSetting('custom:'), 'remember')
	assert.equal(a.parseSetting(' codex '), 'codex')
	assert.equal(a.parseSetting('custom:Gemini'), 'custom:Gemini')
})

test('isTarget rejects stored values it does not understand', () => {
	assert.equal(a.isTarget({ kind: 'session', id: 'x', cli: 'codex' }), true)
	assert.equal(a.isTarget({ kind: 'new', cli: 'custom' }), false)
	assert.equal(a.isTarget({ kind: 'new', cli: 'gemini' }), false)
	assert.equal(a.isTarget({ kind: 'chat' }), true)
	assert.equal(a.isTarget('codex'), false)
	assert.equal(a.isTarget(null), false)
})

test('oneLine removes everything a terminal would act on', () => {
	assert.equal(a.oneLine('a\nb\r\n c'), 'a b c')
	assert.equal(a.oneLine('draft\r'), 'draft', 'a lone CR is Enter')
	assert.equal(a.oneLine('x\x03y\x1b[A'), 'x y [A')
	assert.equal(a.oneLine('  \n '), '')
})

test('files: @-mentions for Claude, plain paths for the rest', () => {
	assert.equal(a.withFiles('About it: ', ['/t/f.md'], 'claude'), '@/t/f.md About it: ')
	assert.equal(a.withFiles('About it: ', ['/t/f.md'], 'codex'), '/t/f.md About it: ')
	assert.equal(a.withFiles('About it: ', [], 'claude'), 'About it: ')
})

test('Compact and Measure are typed only at the prompt, by kind, never into a permission menu', () => {
	assert.equal(a.slashText('compact', 'claude'), '/compact')
	assert.equal(a.slashText('compact', 'codex'), '/compact')
	assert.equal(a.slashText('context', 'claude'), '/context')
	assert.equal(a.slashText('context', 'codex'), undefined, 'Codex has no /context')
	assert.equal(a.slashText('compact', 'custom'), undefined)
	assert.equal(a.slashRefusal(s('a', 'claude', 'idle', 1), 'compact'), undefined)
	assert.equal(a.slashRefusal(s('a', 'codex', 'done', 1), 'compact'), undefined)
	assert.equal(a.slashRefusal(s('a', 'claude', 'blocked', 1), 'compact'), 'waiting', 'the Enter would approve the open permission prompt')
	assert.equal(a.slashRefusal(s('a', 'claude', 'working', 1), 'context'), 'busy')
	assert.equal(a.slashRefusal(s('a', 'claude', 'idle', 1, { heard: false }), 'compact'), 'not-ready', 'no hook has said it sits at its prompt')
	assert.equal(a.slashRefusal(s('a', 'claude', 'idle', 1, { alive: false }), 'compact'), 'no-terminal')
	assert.equal(a.slashRefusal(s('a', 'codex', 'idle', 1), 'context'), 'unsupported')
	assert.equal(a.slashRefusal(s('a', 'custom', 'unknown', 1), 'compact'), 'unsupported')
	assert.equal(a.slashRefusal(undefined, 'compact'), 'unknown')
})

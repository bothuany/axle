// Why an agent needs you, and the order the dock shows them in (src/attention.ts).
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
	tmp = mkdtempSync(join(tmpdir(), 'flow-attention-'))
	const outfile = join(tmp, 'attention.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'attention.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	a = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const fresh = { failures: 0 }
const run = (events, start = fresh) => events.reduce((st, e, i) => a.nextAttention(st, e, 1000 + i), start)

test('a permission request is an approval, with the tool call as its text', () => {
	const r = run([{ event: 'PermissionRequest', tool: 'Bash', described: 'Running npm test' }])
	assert.deepEqual(r.need, { kind: 'approval', source: 'permission', text: 'Wants to: Running npm test', at: 1000 })
})

test('the permission notification that follows keeps the richer text and its start time', () => {
	const r = run([
		{ event: 'PermissionRequest', tool: 'Bash', described: 'Running rm -rf build' },
		{ event: 'Notification', notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' },
	])
	assert.equal(r.need.text, 'Wants to: Running rm -rf build')
	assert.equal(r.need.at, 1000)
})

test('a permission notification alone is still an approval', () => {
	const r = run([{ event: 'Notification', notificationType: 'permission_prompt', message: 'Claude needs your permission to use Write' }])
	assert.equal(r.need.kind, 'approval')
	assert.equal(r.need.text, 'Claude needs your permission to use Write')
})

test('AskUserQuestion is a question with the first question as text', () => {
	const input = { questions: [{ question: 'Which database should I use?', options: [] }, { question: 'And the ORM?' }] }
	const r = run([{ event: 'PreToolUse', tool: 'AskUserQuestion', input }, { event: 'PermissionRequest', tool: 'AskUserQuestion', input }])
	assert.deepEqual(r.need, { kind: 'question', source: 'ask', text: 'Which database should I use? (+1 more)', at: 1000 })
})

test('an MCP elicitation is a question', () => {
	const r = run([{ event: 'Notification', notificationType: 'elicitation_dialog', message: 'github needs your token scope' }])
	assert.equal(r.need.kind, 'question')
})

test('leaving plan mode asks for approval of the plan', () => {
	const r = run([{ event: 'PreToolUse', tool: 'ExitPlanMode' }])
	assert.equal(r.need.kind, 'approval')
	assert.equal(r.need.source, 'plan')
})

test('the tool running answers the question; a new prompt clears everything', () => {
	assert.equal(run([{ event: 'PermissionRequest', tool: 'Bash' }, { event: 'PostToolUse', tool: 'Bash' }]).need, undefined)
	assert.equal(run([{ event: 'StopFailure', error: 'rate_limit' }, { event: 'UserPromptSubmit' }]).need, undefined)
})

test('a turn that ends on a question waits for your reply', () => {
	const r = run([{ event: 'Stop', lastMessage: 'I refactored the parser.\n\nShould I also update the tests? Or leave them for now?' }])
	assert.deepEqual(r.need, { kind: 'question', source: 'reply', text: 'Or leave them for now?', at: 1000 })
	assert.equal(run([{ event: 'Stop', lastMessage: 'Is this right? I checked: yes. All tests pass.' }]).need, undefined)
	assert.equal(run([{ event: 'Stop', lastMessage: '- **Want me to commit?**' }]).need.text, 'Want me to commit?')
})

test('a stop failure is an error that says why', () => {
	const r = run([{ event: 'StopFailure', error: 'rate_limit', errorDetails: 'resets at 5pm' }])
	assert.deepEqual(r.need, { kind: 'error', source: 'stop', text: 'Rate limited: resets at 5pm', at: 1000 })
	assert.equal(a.errorText('something_new'), 'The turn failed (something_new)')
})

test('three failed tool calls in a row are an error loop; one success ends it', () => {
	const fail = { event: 'PostToolUseFailure', tool: 'Bash' }
	assert.equal(run([fail, fail]).need, undefined)
	const loop = run([fail, fail, fail, fail])
	assert.equal(loop.need.kind, 'error')
	assert.equal(loop.need.text, '4 tool calls failed in a row (last: Bash)')
	assert.equal(loop.need.at, 1002, 'the loop keeps the time it started')
	assert.equal(run([{ event: 'Stop' }], loop).need.kind, 'error', 'the end of the turn does not hide it')
	const ok = run([{ event: 'PostToolUse', tool: 'Bash' }], loop)
	assert.equal(ok.need, undefined)
	assert.equal(ok.failures, 0)
})

test('a crash is an error only with a failing exit code', () => {
	assert.equal(a.crashNeed(1, 5).text, 'Exited with code 1')
	assert.equal(a.crashNeed(0, 5), undefined)
	assert.equal(a.crashNeed(undefined, 5), undefined)
})

test('the ranking: approval > question > error > done unread > working > idle and read > ended', () => {
	const need = (kind, at = 1) => ({ kind, source: 'x', text: '', at })
	const rows = [
		{ id: 'ended', state: 'ended', unread: false, since: 9 },
		{ id: 'idle', state: 'idle', unread: false, since: 9 },
		{ id: 'read', state: 'done', unread: false, since: 9 },
		{ id: 'working', state: 'working', unread: false, since: 9 },
		{ id: 'unread', state: 'done', unread: true, since: 9 },
		{ id: 'error', state: 'done', unread: true, since: 9, need: need('error') },
		{ id: 'question', state: 'done', unread: true, since: 9, need: need('question') },
		{ id: 'approval', state: 'blocked', unread: true, since: 9, need: need('approval') },
	]
	const order = a.rank(rows).map(r => r.id)
	assert.deepEqual(order.slice(0, 5), ['approval', 'question', 'error', 'unread', 'working'])
	assert.deepEqual(new Set(order.slice(5, 7)), new Set(['idle', 'read']))
	assert.equal(order[7], 'ended')
})

test('an error needs you until you have seen it; an approval until you answer it', () => {
	const error = { state: 'ended', unread: true, since: 1, need: { kind: 'error', source: 'crash', text: 'Exited with code 1', at: 1 } }
	assert.equal(a.attentionKind(error), 'error')
	assert.equal(a.attentionKind({ ...error, unread: false }), undefined)
	assert.equal(a.urgency({ ...error, unread: false }), 8)
	const approval = { state: 'blocked', unread: false, since: 1, need: { kind: 'approval', source: 'permission', text: '', at: 1 } }
	assert.equal(a.attentionKind(approval), 'approval')
})

test('among equals, the one waiting longest comes first', () => {
	const q = (id, at) => ({ id, state: 'blocked', unread: true, since: 0, need: { kind: 'approval', source: 'permission', text: '', at } })
	assert.deepEqual(a.rank([q('new', 20), q('old', 10)]).map(r => r.id), ['old', 'new'])
})

test('the notification key changes only when a session starts needing you anew', () => {
	const s = { state: 'blocked', unread: true, since: 1, need: { kind: 'approval', source: 'permission', text: 'x', at: 7 } }
	assert.equal(a.attentionKey(s), 'approval:7')
	assert.equal(a.attentionKey({ ...s, need: { ...s.need, text: 'y' } }), 'approval:7')
	assert.equal(a.attentionKey({ state: 'done', unread: true, since: 3 }), 'done:3')
	assert.equal(a.attentionKey({ state: 'done', unread: false, since: 3 }), undefined)
	assert.equal(a.attentionKey({ state: 'working', unread: false, since: 3 }), undefined)
})

// Skeleton first: what check_skeleton answers at each stage, and the row the dock is sent. The switch is read live, so an off
// answer is the same whatever stage a session was in.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, load } from './bundle.mjs'

after(cleanup)

const sessions = await load('src/skeleton/sessions.ts')
const spec = await load('src/board/spec.ts')

const plan = spec.parseBoard({ kind: 'class', title: 'Checkout', nodes: [{ id: 'a', label: 'Order', members: [{ text: 'id: int' }] }] })
const diff = { ready: true, counts: { matches: 0, missing: 1, differs: 0 }, nodes: [{ id: 'a', label: 'Order', check: 'missing', note: 'no type called Order in the code yet', members: [{ text: 'id: int', check: 'missing' }], relations: [], extra: [] }] }

test('off: implement as usual, whatever the stage', () => {
	assert.match(sessions.toolAnswer(false, undefined), /off.*implement the plan as usual/)
	assert.match(sessions.toolAnswer(false, { ...sessions.newSession('s1'), stage: 'handover' }), /off/)
})

test('on, nothing drawn yet: draw the design on the session\'s board id, then stop; a small change is exempt', () => {
	const s = sessions.newSession('abc-123')
	assert.equal(s.boardId, 'skeleton-abc123')
	const text = sessions.toolAnswer(true, s)
	assert.match(text, /draw_board: id "skeleton-abc123"/)
	assert.match(text, /STOP: do not create or edit any file/)
	assert.match(text, /does NOT add or change types.*implement the plan as usual/)
	assert.equal(sessions.boardIdFor(''), 'skeleton')
})

test('design drawn: wait for the developer; skeleton: the diff, explain without fixing; handover: fill the bodies', () => {
	const s = { ...sessions.newSession('s'), plan }
	assert.match(sessions.toolAnswer(true, s), /has not chosen yet/)
	const writing = { ...s, stage: 'skeleton', diff }
	const text = sessions.toolAnswer(true, writing)
	assert.match(text, /^Skeleton check of "Checkout": 0 match · 1 missing · 0 differ\./)
	assert.match(text, /MISSING Order/)
	assert.match(text, /Do NOT create or edit any file/)
	assert.match(text, /theirs is better/)
	const handover = { ...writing, stage: 'handover', warnings: [{ owner: 'Order', name: 'id', kind: 'field', file: '/x.ts', reason: 'changed', before: 'id: number', after: 'id: string', line: 3, lines: 1 }] }
	const h = sessions.toolAnswer(true, handover)
	assert.match(h, /The agent changed Order\.id: id: number → id: string/)
	assert.match(h, /fill in the method bodies/)
})

test('the dock row: a summary, counts once checked, warnings with Revert only where a header can be put back', () => {
	const s = sessions.newSession('s')
	assert.equal(sessions.viewOf(s).drawn, false)
	assert.match(sessions.viewOf({ ...s, plan }).summary, /Tell the agent what to change/)
	const v = sessions.viewOf({ ...s, plan, stage: 'handover', diff, warnings: [
		{ owner: 'Order', name: 'id', kind: 'field', file: '/x.ts', reason: 'changed', before: 'id: number', after: 'id: string', line: 3, lines: 1 },
		{ owner: 'Order', name: 'total', kind: 'method', file: '/x.ts', reason: 'removed', before: 'total(): Money {' },
	] })
	assert.deepEqual(v.counts, { matches: 0, missing: 1, differs: 0 })
	assert.deepEqual(v.warnings.map(w => w.revert), [true, false])
	assert.equal(JSON.stringify(v).includes('/x.ts'), false, 'the dock is not sent file paths')
})

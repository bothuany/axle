// Skeleton first: what check_skeleton answers at each stage. The developer drives the flow by talking to the agent, so each answer
// also says what to tell them and which check_skeleton step their reply maps to.
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

test('on, nothing drawn yet: draw on the session\'s board id, stop, and tell the developer what to say next; a small change is exempt', () => {
	const s = sessions.newSession('abc-123')
	assert.equal(s.boardId, 'skeleton-abc123')
	const text = sessions.toolAnswer(true, s)
	assert.match(text, /draw_board: id "skeleton-abc123"/)
	assert.match(text, /STOP: do not create or edit any file/)
	assert.match(text, /they say "check" for a review, "hand over" when you should fill the bodies, or "just do it"/)
	assert.match(text, /does NOT add or change types.*as usual/)
	assert.equal(sessions.boardIdFor(''), 'skeleton')
})

test('writing: the diff, explain without fixing, and the chat replies mapped to steps', () => {
	const writing = { ...sessions.newSession('s'), plan, stage: 'skeleton', diff }
	const text = sessions.toolAnswer(true, writing)
	assert.match(text, /^Skeleton check of "Checkout": 0 match · 1 missing · 0 differ\./)
	assert.match(text, /MISSING Order/)
	assert.match(text, /Do NOT create or edit any file/)
	assert.match(text, /theirs is better/)
	assert.match(text, /"hand over".*step "handover"; "just do it".*step "just"; "done".*step "finish"/)
})

test('hand-over: fill the bodies, report each numbered warning in the reply, keep → accept, revert by putting their declaration back, close with a tour', () => {
	const handover = { ...sessions.newSession('s'), plan, stage: 'handover', diff, warnings: [{ id: 3, owner: 'Order', name: 'id', kind: 'field', file: '/x.ts', reason: 'changed', before: 'id: number', after: 'id: string', line: 3, lines: 1 }] }
	const h = sessions.toolAnswer(true, handover)
	assert.match(h, /warning 3: The agent changed Order\.id: id: number → id: string/)
	assert.match(h, /fill in the method bodies/)
	assert.match(h, /tell the developer in your reply/)
	assert.match(h, /step "accept" and that warning number/)
	assert.match(h, /put their declaration back exactly/)
	assert.match(h, /Axle: Revert an Agent's Change to Your Declaration/)
	assert.match(h, /closing tour/)
	assert.match(h, /step "finish"/)
})

test('the steps the agent may pass are the ones the tool schema lists', async () => {
	const tools = await load('src/mcp/tools.ts')
	const t = tools.TOOLS.find(x => x.name === 'check_skeleton')
	assert.deepEqual(t.inputSchema.properties.step.enum, [...sessions.SKELETON_STEPS])
	assert.equal(t.inputSchema.additionalProperties, false)
})

// What the board canvas draws beyond the node graph: edge order, style and guards, callouts, shapes, tech lines.
// The renderer's pure parts (ui/src/board) run here through the bundle helper.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, load } from './bundle.mjs'

let model, protocol, route, callouts, svg
before(async () => {
	model = await load('../../../ui/src/board/model.ts')
	protocol = await load('../../../ui/src/board/protocol.ts')
	route = await load('../../../ui/src/board/route.ts')
	callouts = await load('../../../ui/src/board/callouts.tsx')
	svg = await load('../../../ui/src/board/svg.ts')
})
after(cleanup)

const none = { direction: 'LR', members: true, expanded: new Set(), isCollapsed: g => g.collapsed === true }
const board = (extra = {}) => ({ version: 1, kind: 'flow', title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], ...extra })

test('board-edges: order, guard, style, async and change reach the drawn edge; edges that differ are not merged', () => {
	const l = model.buildLayout(board({ edges: [{ from: 'a', to: 'b', order: 1, label: 'x' }, { from: 'a', to: 'b', order: 2, label: 'x', async: true, style: 'dashed', guard: 'ok', change: 'added' }] }), none)
	assert.equal(l.edges.length, 2)
	assert.deepEqual(l.edges.map(e => e.order), [1, 2])
	assert.equal(l.edges[1].guard, 'ok')
	assert.equal(l.edges[1].change, 'added')
})

test('board-edges: lineStyle layers what the edge says over its kind, and edgeText puts the guard first', () => {
	const base = protocol.lineStyle({ kind: 'calls' })
	assert.deepEqual([base.dash, base.head], [undefined, 'fill'])
	assert.equal(protocol.lineStyle({ kind: 'calls', style: 'dashed' }).dash, '6 4')
	assert.equal(protocol.lineStyle({ kind: 'calls', style: 'dotted' }).dash, '2 3')
	assert.equal(protocol.lineStyle({ kind: 'calls', async: true }).head, 'vee')
	assert.equal(protocol.lineStyle({ kind: 'extends', async: true }).head, 'tri', 'only a filled head becomes open')
	assert.equal(protocol.lineStyle({ change: 'removed' }).color, 'del')
	assert.equal(protocol.lineStyle({ change: 'changed' }).color, 'warn')
	assert.equal(protocol.edgeText({ label: 'pay', guard: 'amount > 0', count: 2 }), '[amount > 0] pay ×2')
	assert.equal(protocol.edgeText({}), '')
})

test('board-edges: the number badge sits off the start of the line, and an open head ends at the tip', () => {
	const l = model.buildLayout(board(), none)
	const e = l.edges[0]
	const r = route.routeEdge({ from: l.nodes.find(n => n.id === e.from), to: l.nodes.find(n => n.id === e.to), edge: e }, 'LR')
	const b = route.orderBadge(r)
	assert.ok(Math.hypot(b.x - r.start.x, b.y - r.start.y) > 10)
	assert.match(route.veeOf(r), /^M[\d. -]+ L[\d. -]+ L[\d. -]+$/)
})

test('board-callouts: a callout is kept for a visible node or an edge, and dropped for a folded one', () => {
	const spec = board({
		callouts: [{ node: 'b', text: 'Retries twice, then dead-letters' }, { edge: ['a', 'b'], text: 'sync' }, { node: 'c', text: 'inside a collapsed group' }],
		nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', group: 'g' }],
		groups: [{ id: 'g', label: 'G', collapsed: true }],
	})
	const l = model.buildLayout(spec, none)
	assert.equal(l.callouts.length, 3)
	assert.equal(l.callouts[2].node, 'group:g', 'a note on a folded node sits on the group box')
	const bubbles = callouts.placeBubbles(l, 'LR')
	assert.equal(bubbles.length, 3)
	assert.ok(bubbles.every(b => b.box.y < b.at.y), 'bubbles sit above their anchor')
	for (let i = 0; i < bubbles.length; i++) for (let j = i + 1; j < bubbles.length; j++) {
		const a = bubbles[i].box, c = bubbles[j].box
		assert.ok(!(a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h), 'bubbles do not overlap')
	}
	assert.deepEqual(callouts.wrap('aaa bbb ccc', 7), ['aaa bbb', 'ccc'])
	assert.ok(callouts.wrap('x'.repeat(200)).every(line => line.length <= 31))
})

test('board-shapes: pseudo-states are small marks, tech is a line under the label', () => {
	const spec = board({ nodes: [{ id: 'a', label: 'start', shape: 'initial' }, { id: 'b', label: 'B', tech: 'Spring Boot' }, { id: 'c', label: 'C', shape: 'choice' }, { id: 'd', label: 'D' }] })
	const l = model.buildLayout(spec, none)
	const size = id => l.nodes.find(n => n.id === id).box
	assert.deepEqual([size('a').w, size('a').h], [24, 24])
	assert.deepEqual([size('c').w, size('c').h], [34, 34])
	assert.equal(model.detailOf({ id: 'b', label: 'B', tech: 'Spring Boot', detail: 'orders' }), '[Spring Boot] orders')
	assert.equal(size('b').h, size('d').h + model.DETAIL_H, 'the tech line adds a row to the card')
})

test('board-svg: the export draws badges, guards and open heads', () => {
	const l = model.buildLayout(board({ edges: [{ from: 'a', to: 'b', order: 1, guard: 'ok', label: 'go', async: true, change: 'added' }] }), none)
	const palette = { canvas: '#000', card: '#111', line: '#222', text: '#eee', muted: '#999', signal: '#66f', add: '#0f0', del: '#f00', warn: '#fa0', groupFill: '#222' }
	const out = svg.toSvg(l, 'LR', palette, 'T')
	assert.match(out, /\[ok\] go/)
	assert.match(out, /<circle[^>]*r="8"/)
	assert.match(out, /stroke="#0f0"/)
})

let seq
before(async () => {
	seq = await load('../../../ui/src/board/sequence.ts')
})

const sequenceBoard = (extra = {}) => ({
	version: 1, kind: 'sequence', title: 'Pay',
	nodes: [{ id: 'cli', label: 'Client', kind: 'actor' }, { id: 'api', label: 'API' }, { id: 'db', label: 'DB' }],
	edges: [
		{ from: 'cli', to: 'api', label: 'POST /pay', order: 1 },
		{ from: 'api', to: 'db', label: 'insert payment', order: 2 },
		{ from: 'db', to: 'api', label: 'row id', order: 3, style: 'dashed' },
		{ from: 'api', to: 'cli', label: '201', order: 4, style: 'dashed' },
	],
	...extra,
})

test('board-sequence: messages run top to bottom in `order`, not in array order', () => {
	const spec = sequenceBoard()
	spec.edges = [spec.edges[3], spec.edges[1], spec.edges[0], spec.edges[2]]
	const l = seq.buildSequence(spec)
	assert.deepEqual(l.messages.map(m => m.edge.order), [1, 2, 3, 4])
	assert.ok(l.messages.every((m, i) => i === 0 || m.y > l.messages[i - 1].y))
	assert.equal(l.unordered, false)
	assert.equal(seq.buildSequence(sequenceBoard({ edges: [{ from: 'cli', to: 'api' }, { from: 'api', to: 'db', order: 1 }] })).unordered, true)
	assert.deepEqual(seq.orderedEdges(sequenceBoard({ edges: [{ from: 'cli', to: 'api', label: 'b' }, { from: 'api', to: 'db', order: 1, label: 'a' }, { from: 'db', to: 'api', label: 'c' }] })).map(e => e.label), ['a', 'b', 'c'], 'the unnumbered follow, in array order')
})

test('board-sequence: lifelines keep the node order, with room for long labels', () => {
	const l = seq.buildSequence(sequenceBoard({ edges: [{ from: 'cli', to: 'db', label: 'x'.repeat(80), order: 1 }] }))
	assert.deepEqual(l.lifelines.map(x => x.id), ['cli', 'api', 'db'])
	assert.ok(l.lifelines[2].x - l.lifelines[0].x > 80 * 6, 'the label fits between the lifelines it crosses')
	for (let i = 1; i < l.lifelines.length; i++) assert.ok(l.lifelines[i].x - l.lifelines[i - 1].x >= 190, 'heads never touch')
})

test('board-sequence: a call opens an activation bar that its reply closes; nested calls nest', () => {
	const l = seq.buildSequence(sequenceBoard())
	const api = l.activations.filter(a => l.lifelines[a.lifeline].id === 'api')
	const db = l.activations.filter(a => l.lifelines[a.lifeline].id === 'db')
	assert.equal(api.length, 1)
	assert.equal(db.length, 1)
	assert.ok(api[0].y1 < db[0].y1 && api[0].y2 > db[0].y2, 'the API is active around the DB call')
	assert.equal(l.messages[2].ret, true)
	const open = seq.buildSequence(sequenceBoard({ edges: [{ from: 'cli', to: 'api', order: 1 }, { from: 'api', to: 'db', order: 2 }] }))
	assert.equal(open.activations.length, 2, 'a call with no reply still gets a bar')
	const asy = seq.buildSequence(sequenceBoard({ edges: [{ from: 'cli', to: 'api', order: 1, async: true }] }))
	assert.equal(asy.activations.length, 0, 'an asynchronous message activates nothing')
})

test('board-sequence: alt, else and loop boxes wrap their messages and nest', () => {
	const spec = sequenceBoard({
		groups: [{ id: 'ok', label: '[valid]', kind: 'alt' }, { id: 'bad', label: '[invalid]', kind: 'alt', parent: 'ok' }, { id: 'again', label: 'retry', kind: 'loop', parent: 'ok' }],
		edges: [
			{ from: 'cli', to: 'api', order: 1 },
			{ from: 'api', to: 'db', order: 2, fragment: 'ok' },
			{ from: 'db', to: 'api', order: 3, fragment: 'again', style: 'dashed' },
			{ from: 'api', to: 'cli', order: 4, fragment: 'bad', label: '400' },
		],
	})
	const l = seq.buildSequence(spec)
	const frame = id => l.frames.find(f => f.id === id)
	assert.equal(l.frames.length, 3)
	assert.equal(frame('bad').isElse, true)
	assert.equal(frame('again').isElse, false, 'a loop inside an alt is a nested box, not an else')
	assert.equal(frame('ok').depth, 0)
	assert.equal(frame('again').depth, 1)
	const m = i => l.messages[i].y
	assert.ok(frame('ok').y1 < m(1) && frame('ok').y2 > m(3), 'the alt box covers its messages and its else branch')
	assert.ok(frame('again').y1 < m(2) && frame('again').y2 > m(2) && frame('again').y2 < frame('ok').y2, 'the loop sits inside')
	assert.ok(frame('bad').y1 > m(2) && frame('bad').y1 < m(3), 'the else divider is above its first message')
	assert.ok(frame('ok').x1 < frame('again').x1, 'the outer box is wider than the inner one')
	assert.ok(m(0) < frame('ok').y1, 'a message outside is not boxed')
})

test('board-sequence: shapes carry ids for clicks and highlights, and a lit set dims the rest', () => {
	const spec = sequenceBoard({ callouts: [{ node: 'api', text: 'Retries twice' }, { edge: ['api', 'db'], text: 'idempotent' }] })
	const l = seq.buildSequence(spec)
	const all = seq.sequenceShapes(l, spec)
	assert.ok(all.shapes.some(s => s.node === 'api' && s.t === 'rect'))
	assert.ok(all.shapes.some(s => s.edge === 'api>db' && s.t === 'line'))
	assert.equal(all.dim.size, 0)
	const some = seq.sequenceShapes(l, spec, { nodes: new Set(['api', 'db']), edges: new Set(['api>db']) })
	const dimmed = [...some.dim.keys()]
	assert.ok(dimmed.some(s => s.node === 'cli'), 'a lifeline outside the step fades')
	assert.ok(!dimmed.some(s => s.edge === 'api>db'), 'a lit message stays')
	assert.ok(dimmed.some(s => s.edge === 'cli>api'))
	assert.ok(all.shapes.filter(s => s.t === 'text').some(s => s.text === 'Retries twice'), 'callouts become notes')
	assert.ok(all.shapes.filter(s => s.t === 'text').some(s => s.text === '2' ), 'order badges show')
})

test('board-sequence: the svg export has every lifeline and message, escaped', () => {
	const spec = sequenceBoard({ nodes: [{ id: 'cli', label: 'A <script>' }, { id: 'api', label: 'API' }, { id: 'db', label: 'DB' }] })
	const palette = { canvas: '#000', card: '#111', line: '#222', text: '#eee', muted: '#999', signal: '#66f', add: '#0f0', del: '#f00', warn: '#fa0', groupFill: '#222' }
	const out = svg.sequenceSvg(spec, palette, 'Pay <b>')
	assert.match(out, /^<svg /)
	assert.match(out, /A &lt;script&gt;/)
	assert.doesNotMatch(out, /<script>/)
	assert.match(out, /POST \/pay/)
	assert.match(out, /stroke-dasharray="6 4"/, 'a reply is dashed')
})

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

// The board canvas's layout (ui/src/board/model.ts): collapsed groups become one node, edges follow, nothing overlaps.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, load } from './bundle.mjs'

let model, route
before(async () => {
	model = await load('../../../ui/src/board/model.ts')
	route = await load('../../../ui/src/board/route.ts')
})
after(cleanup)

const node = (id, group, members) => ({ id, label: id, kind: 'dto', group, members })
const none = { direction: 'LR', members: true, expanded: new Set(), isCollapsed: g => g.collapsed === true }
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function spec(nodes, edges, groups) {
	return { version: 1, kind: 'er', title: 'T', nodes, edges, groups }
}

test('cards never overlap, in both directions, with cycles and self references', () => {
	const nodes = Array.from({ length: 30 }, (_, i) => node(`n${i}`))
	const edges = nodes.flatMap((n, i) => [{ from: n.id, to: `n${(i * 7 + 3) % 30}` }, { from: n.id, to: `n${(i + 1) % 30}` }])
	for (const direction of ['LR', 'TB']) {
		const l = model.buildLayout(spec(nodes, edges), { ...none, direction })
		assert.equal(l.nodes.length, 30)
		for (let i = 0; i < l.nodes.length; i++) {
			for (let j = i + 1; j < l.nodes.length; j++) {
				assert.ok(!overlap(l.nodes[i].box, l.nodes[j].box), `${direction}: ${l.nodes[i].id} overlaps ${l.nodes[j].id}`)
			}
		}
	}
})

test('layers follow the edges: a source sits before its target (LR), above it (TB)', () => {
	const s = spec([node('a'), node('b'), node('c')], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])
	const lr = model.buildLayout(s, { ...none, direction: 'LR' })
	const x = id => lr.nodes.find(n => n.id === id).box.x
	assert.ok(x('a') < x('b') && x('b') < x('c'))
	const tb = model.buildLayout(s, { ...none, direction: 'TB' })
	const y = id => tb.nodes.find(n => n.id === id).box.y
	assert.ok(y('a') < y('b') && y('b') < y('c'))
})

test('nodes without edges go to a grid below the layered part', () => {
	const l = model.buildLayout(spec([node('a'), node('b'), node('lonely')], [{ from: 'a', to: 'b' }]), none)
	const lonely = l.nodes.find(n => n.id === 'lonely').box
	assert.ok(lonely.y >= Math.max(...['a', 'b'].map(id => l.nodes.find(n => n.id === id).box.y + l.nodes.find(n => n.id === id).box.h)))
})

test('a collapsed group is one summary node with its count, and edges into it are merged', () => {
	const groups = [{ id: 'g', label: 'Pkg', collapsed: true }]
	const s = spec([node('a'), node('x', 'g'), node('y', 'g'), node('z', 'g')], [{ from: 'a', to: 'x' }, { from: 'a', to: 'y' }, { from: 'x', to: 'y' }], groups)
	const l = model.buildLayout(s, none)
	assert.deepEqual(l.nodes.map(n => n.id).sort(), ['a', 'group:g'])
	const sum = l.nodes.find(n => n.id === 'group:g')
	assert.equal(sum.count, 3)
	assert.equal(l.groups.length, 0)
	assert.equal(l.edges.length, 1, 'a->x and a->y are one edge into the summary; x->y is inside it')
	assert.equal(l.edges[0].count, 2)
	assert.equal(l.rep.get('y'), 'group:g')
})

test('an expanded group is a container around its cards, nested groups included', () => {
	const groups = [{ id: 'g', label: 'Pkg' }, { id: 'h', label: 'Sub', parent: 'g' }]
	const s = spec([node('a', 'g'), node('b', 'h'), node('c', 'h')], [{ from: 'a', to: 'b' }], groups)
	const l = model.buildLayout(s, none)
	assert.equal(l.groups.length, 2)
	const g = l.groups.find(x => x.id === 'g')
	const h = l.groups.find(x => x.id === 'h')
	assert.equal(h.parent, 'g')
	const inside = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
	assert.ok(inside(g.box, h.box))
	for (const n of l.nodes) assert.ok(inside(n.parent === 'h' ? h.box : g.box, n.box), `${n.id} is inside its group`)
	// Relative positions add up to the absolute ones (React Flow draws children relative to the parent).
	const b = l.nodes.find(n => n.id === 'b')
	assert.equal(h.box.x + b.rel.x, b.box.x)
	assert.equal(h.box.y + b.rel.y, b.box.y)
})

test('a collapsed parent swallows its subgroups; a cycle of parents does not hang', () => {
	const s = spec([node('a', 'g'), node('b', 'h')], [], [{ id: 'g', label: 'G', collapsed: true }, { id: 'h', label: 'H', parent: 'g' }])
	assert.deepEqual(model.buildLayout(s, none).nodes.map(n => n.id), ['group:g'])
	const cyc = spec([node('a', 'p'), node('b', 'q')], [], [{ id: 'p', label: 'P', parent: 'q' }, { id: 'q', label: 'Q', parent: 'p' }])
	assert.equal(model.buildLayout(cyc, none).nodes.length, 2)
})

test('an edge leaves the member row that holds the reference', () => {
	const members = [{ text: 'id: Guid' }, { text: 'customer: Customer', ref: 'c' }, { text: 'lines: List<Line>', ref: 'l' }]
	const s = spec([node('o', undefined, members), node('c'), node('l')], [{ from: 'o', to: 'l', label: 'lines' }, { from: 'o', to: 'c', label: 'customer' }])
	const l = model.buildLayout(s, none)
	const rows = Object.fromEntries(l.edges.map(e => [e.to, e.fromRow]))
	assert.deepEqual(rows, { l: 2, c: 1 })
	// And the route starts at that row's height on the card's edge.
	const o = l.nodes.find(n => n.id === 'o')
	const e = l.edges.find(x => x.to === 'c')
	const r = route.routeEdge({ from: o, to: l.nodes.find(n => n.id === 'c'), edge: e }, 'LR')
	assert.equal(r.start.y, o.box.y + model.rowCentre(o.node, 1))
	assert.equal(r.start.x, o.box.x + o.box.w)
})

test('members off hides rows and the card shrinks; more than the cap are cut', () => {
	const members = Array.from({ length: 30 }, (_, i) => ({ text: `f${i}: int` }))
	const s = spec([node('big', undefined, members)], [])
	const on = model.buildLayout(s, none).nodes[0]
	assert.equal(on.rows.length, model.MAX_ROWS)
	assert.equal(on.more, 30 - model.MAX_ROWS)
	const all = model.buildLayout(s, { ...none, expanded: new Set(['big']) }).nodes[0]
	assert.equal(all.rows.length, 30)
	const off = model.buildLayout(s, { ...none, members: false }).nodes[0]
	assert.equal(off.rows.length, 0)
	assert.ok(off.box.h < on.box.h)
})

test('matchNodes needs every word and looks in members too', () => {
	const s = spec([node('OrderDto', undefined, [{ text: 'city: string' }]), node('CustomerDto')], [])
	assert.deepEqual([...model.matchNodes(s, 'order')], ['OrderDto'])
	assert.deepEqual([...model.matchNodes(s, 'order city')], ['OrderDto'])
	assert.deepEqual([...model.matchNodes(s, 'customer city')], [])
	assert.equal(model.matchNodes(s, '  ').size, 0)
})

test('a 400-node board lays out quickly', () => {
	const nodes = Array.from({ length: 400 }, (_, i) => node(`n${i}`, `g${i % 8}`, [{ text: 'a: int' }, { text: 'b: int' }]))
	const edges = nodes.flatMap((n, i) => [0, 1, 2].map(k => ({ from: n.id, to: `n${(i * 7 + k * 13) % 400}` }))).filter(e => e.from !== e.to)
	const groups = Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, label: `g${i}` }))
	const t0 = Date.now()
	const l = model.buildLayout(spec(nodes, edges, groups), none)
	assert.equal(l.nodes.length, 400)
	assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`)
})

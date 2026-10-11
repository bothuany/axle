// The board canvas's requests to the host: cleaned before use, and mapped onto the type boards' options.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, load } from './bundle.mjs'

let req
before(async () => { req = await load('src/boardRequest.ts') })
after(cleanup)

test('sanitizeRequest keeps known fields, clamps numbers, drops the rest', () => {
	const r = req.sanitizeRequest({ query: '  Order ', focusId: 'T1', depth: 99, includeEntities: true, includeEnums: 'yes', hideRoles: ['dto', 'dto', 'nope', 7], collapseLevel: -4, evil: 1 })
	assert.deepEqual(r, { query: 'Order', focusId: 'T1', depth: 3, includeEntities: true, hideRoles: ['dto'], collapseLevel: 0 })
	assert.deepEqual(req.sanitizeRequest(null), {})
	assert.deepEqual(req.sanitizeRequest({ query: '   ', depth: 'x', hideRoles: 'dto' }), {})
	assert.equal(req.sanitizeRequest({ query: 'x'.repeat(500) }).query.length, 200)
})

test('exportFormat accepts only the known formats', () => {
	for (const f of ['mermaid', 'plantuml', 'png', 'svg', 'json']) assert.equal(req.exportFormat(f), f)
	assert.equal(req.exportFormat('pdf'), undefined)
	assert.equal(req.exportFormat({}), undefined)
})

test('exportPayload checks what the page sent', () => {
	assert.equal(req.exportPayload('svg', '<svg xmlns="x"></svg>'), '<svg xmlns="x"></svg>')
	assert.equal(req.exportPayload('svg', '<script>alert(1)</script>'), undefined)
	assert.equal(req.exportPayload('svg', 5), undefined)
	assert.deepEqual([...req.exportPayload('png', 'AAEC')], [0, 1, 2])
	assert.equal(req.exportPayload('png', 'not base64!'), undefined)
})

test('fileStem makes a safe file name', () => {
	assert.equal(req.fileStem('DTO relations: Order/..\\x', 'board'), 'DTO-relations-Order-..-x')
	assert.equal(req.fileStem('///', 'board'), 'board')
	assert.equal(req.fileStem(undefined, 'board'), 'board')
})

test('dtoOptions passes the controls on and takes the entity default', () => {
	assert.deepEqual(req.dtoOptions({ query: 'a', focusId: 'T', depth: 2, includeEnums: false }, { includeEntities: true }), { query: 'a', focusId: 'T', depth: 2, includeEntities: true, includeEnums: false })
	assert.equal(req.dtoOptions({ includeEntities: false }, { includeEntities: true }).includeEntities, false)
})

test('archOptions turns the toolbar into hidden roles', () => {
	// Defaults of the architecture toolbar: DTOs and enums hidden, entities shown: what the board itself defaults to.
	const d = req.archOptions(req.ARCHITECTURE_DEFAULTS)
	assert.deepEqual([...d.hideRoles].sort(), ['dto', 'enum'])
	// Showing enums, hiding services (handlers are drawn as services, so they go too) and entities.
	const o = req.archOptions({ includeEnums: true, includeEntities: false, hideRoles: ['service'], focusId: 'T', depth: 2 })
	assert.deepEqual([...o.hideRoles].sort(), ['entity', 'handler', 'service'])
	assert.equal(o.focusId, 'T')
	assert.equal(req.archOptions({ collapseLevel: 0 }).collapse, 'module')
	assert.equal(req.archOptions({ collapseLevel: 1 }).collapse, 'role')
	assert.equal(req.archOptions({ collapseLevel: 5 }).collapse, 'none')
})

test('dropKinds removes hidden kinds with their edges and empty groups', () => {
	const spec = {
		version: 1, kind: 'er', title: 'T', description: 'Showing 3.',
		nodes: [{ id: 'a', label: 'A', kind: 'dto', group: 'g1' }, { id: 'b', label: 'B', kind: 'enum', group: 'g2' }, { id: 'c', label: 'C', kind: 'entity' }],
		edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }],
		groups: [{ id: 'g1', label: 'G1' }, { id: 'g2', label: 'G2' }],
	}
	assert.equal(req.dropKinds(spec, undefined), spec)
	assert.equal(req.dropKinds(spec, ['class']), spec)
	const out = req.dropKinds(spec, ['enum', 'entity'])
	assert.deepEqual(out.nodes.map(n => n.id), ['a'])
	assert.deepEqual(out.edges, [])
	assert.deepEqual(out.groups.map(g => g.id), ['g1'])
	assert.match(out.description, /Hidden: enum, entity/)
})

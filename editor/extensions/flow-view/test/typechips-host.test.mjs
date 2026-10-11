// The type chips of the flow canvas, host side: the types in a method's signature (found by the file and line a card starts at) and the tree behind a chip.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup } from './bundle.mjs'
import { csharpResponse, graphOf, mod, short } from './types-helpers.mjs'

after(cleanup)

const chips = await mod('chips')
const boards = await mod('boards')

const methodLine = (g, type, name) => {
	const t = g.types.find(x => x.name === type)
	return { file: t.file, line: t.methods.find(m => m.name === name).line, endLine: t.methods.find(m => m.name === name).endLine }
}

test('chips: a parameter and the return type of a Java method, wrappers and collections seen through', async () => {
	const g = await graphOf('java-shop')
	const create = methodLine(g, 'OrderController', 'create')
	const c = chips.chipsOf(g, create.file, create.line)
	assert.deepEqual(c.params.map(p => [p.name, p.typeName, p.role, p.collection]), [['request', 'CreateOrderRequest', 'dto', 'one']])
	assert.deepEqual([c.returns.typeName, c.returns.role, c.returns.collection, c.returns.ref], ['OrderDto', 'dto', 'one', 'ResponseEntity<OrderDto>'])
	assert.ok(c.returns.file.endsWith('OrderDto.java') && c.returns.line > 0)
	const list = methodLine(g, 'OrderController', 'list')
	const l = chips.chipsOf(g, list.file, list.line)
	assert.deepEqual([l.params.length, l.returns.typeName, l.returns.collection], [0, 'OrderDto', 'many'])
})

test('chips: a method of plain types has none, an unknown place has none', async () => {
	const g = await graphOf('java-shop')
	assert.equal(chips.chipsOf(g, '/nowhere/Nothing.java', 3), undefined)
	const withNone = g.funcs.filter(f => !f.params.some(p => p.refs.length) && !f.returns?.refs.length)
	assert.equal(withNone.length, 0, 'a signature without a workspace type is not kept')
})

test('signatureOf: the declared types, as written', async () => {
	const g = await graphOf('java-shop')
	const create = methodLine(g, 'OrderController', 'create')
	assert.deepEqual(chips.signatureOf(g, create.file, create.line), { params: [{ name: 'request', type: 'CreateOrderRequest' }], returns: 'ResponseEntity<OrderDto>' })
})

test('chips: the index of a TypeScript project, class methods and all', async () => {
	const g = await graphOf('ts-app')
	assert.ok(g.funcs.length > 0)
	const f = g.funcs.find(x => x.params.some(p => p.refs.length))
	assert.ok(f, 'a method that takes a DTO')
	const c = chips.chipsOf(g, f.file, f.line)
	assert.ok(c.params.length > 0)
	assert.equal(short(c.params[0].typeId), c.params[0].typeName)
})

test('chips: C# methods are found from the first attribute line of the card, and a window that is too wide is not guessed', async () => {
	const response = csharpResponse()
	const methods = response.types.find(t => t.name === 'OrdersController').methods
	Object.assign(methods.find(m => m.name === 'Get'), { line: 12, endLine: 15 })
	Object.assign(methods.find(m => m.name === 'Post'), { line: 20, endLine: 25 })
	const g = await graphOf([], { csharp: response })
	const post = g.funcs.find(f => f.name === 'Post' && f.owner === 'OrdersController')
	assert.ok(post)
	const exact = chips.chipsOf(g, post.file, post.line)
	assert.deepEqual([exact.params[0].typeName, exact.returns.typeName], ['CreateOrderCommand', 'OrderDto'])
	// a card starting at the attribute above the method
	assert.equal(chips.chipsOf(g, post.file, post.line - 2, post.endLine).returns.typeName, 'OrderDto')
	// ... but not at a line far above, nor when the end differs
	assert.equal(chips.chipsOf(g, post.file, post.line - 2, post.endLine + 5), undefined)
	assert.equal(chips.chipsOf(g, post.file, post.line - 30), undefined)
	// the drive letter and the slashes do not matter
	assert.ok(chips.chipsOf(g, post.file.replace(/\//g, '\\'), post.line))
})

test('typeTree: one level at a time, links to the types fields refer to, enum constants, cycles', async () => {
	const g = await graphOf('java-shop')
	const order = chips.typeTree(g, 'OrderDto')
	assert.equal(order.name, 'OrderDto')
	assert.deepEqual(order.fields.map(f => f.name), ['id', 'address', 'lines', 'note', 'status'])
	const lines = order.fields.find(f => f.name === 'lines')
	assert.deepEqual([lines.card, lines.ref.name, lines.ref.role, lines.child], ['many', 'OrderLineDto', 'dto', undefined])
	assert.equal(order.fields.find(f => f.name === 'id').ref, undefined)
	const status = chips.typeTree(g, order.fields.find(f => f.name === 'status').ref.id)
	assert.deepEqual([status.kind, status.constants], ['enum', ['NEW', 'PAID', 'SHIPPED']])
	// depth 1 fills the children, a type that holds itself stays a link
	const deep = chips.typeTree(g, 'OrderDto', undefined, 1)
	assert.equal(deep.fields.find(f => f.name === 'lines').child.fields.find(f => f.name === 'price').ref.name, 'Money')
	const category = chips.typeTree(g, 'CategoryDto', undefined, 3)
	const parent = category.fields.find(f => f.name === 'parent')
	assert.deepEqual([parent.child, parent.ref.name], [undefined, 'CategoryDto'])
	assert.equal(chips.typeTree(g, 'NoSuchType'), undefined)
})

test('the architecture board draws a handler as an entry', async () => {
	const g = await graphOf([], {
		csharp: {
			types: [
				{ fqn: 'Shop.OrderCreatedHandler', name: 'OrderCreatedHandler', namespace: 'Shop', project: 'Shop', kind: 'class', file: '/src/H.cs', line: 1, endLine: 5, interfaces: [], attributes: [], isAbstract: false, isStatic: false, typeParameters: [], fields: [], methods: [], constructorParameters: [], enumMembers: [] },
			],
			entries: [],
		},
	})
	const handler = g.types.find(t => t.name === 'OrderCreatedHandler')
	assert.equal(handler.role, 'handler')
	const board = boards.architectureBoard(g, { hideRoles: [] })
	assert.equal(board.nodes.find(n => n.label === 'OrderCreatedHandler').kind, 'entry')
	// the text exports still draw it
	const exporter = await mod('export')
	assert.match(exporter.exportMermaid(board), /OrderCreatedHandler/)
	assert.match(exporter.exportPlantUml(board), /OrderCreatedHandler/)
})

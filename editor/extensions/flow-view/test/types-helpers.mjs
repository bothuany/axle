// Shared by the types-*.test.mjs files: the type model's modules bundled once, the type graph of a fixture project built through the real index worker, and a C# analyzer response written by hand.
import { join } from 'node:path'
import { Index, ROOT } from './helpers.mjs'
import { load } from './bundle.mjs'

export const FIXTURES = join(ROOT, 'test', 'types-fixtures')

const modules = {}
export const mod = name => (modules[name] ??= load(`src/types/${name}.ts`))

const facts = new Map()

/** The index's type facts of a fixture (one worker per fixture and process). */
export async function polyFacts(fixture) {
	if (!facts.has(fixture)) {
		facts.set(fixture, (async () => {
			const index = new Index(join(FIXTURES, fixture))
			try {
				await index.ready
				return await index.request('typeFacts')
			} finally {
				await index.close()
			}
		})())
	}
	return facts.get(fixture)
}

/** A type graph of one or more fixtures (their facts are merged: each is its own module) plus an optional analyzer response. */
export async function graphOf(fixtures, { csharp, options } = {}) {
	const { buildTypeGraph } = await mod('graph')
	const { nearestServiceResolver } = await mod('service')
	const names = [].concat(fixtures)
	const all = await Promise.all(names.map(polyFacts))
	const poly = names.length ? { files: all.flatMap(f => f.files), calls: all.flatMap(f => f.calls), entries: all.flatMap(f => f.entries) } : undefined
	return buildTypeGraph({ poly, csharp, options, moduleOf: nearestServiceResolver(names.map(n => join(FIXTURES, n))) })
}

/** Ids shortened for readable assertions: `java:com.acme.shop.dto.OrderDto` → OrderDto. */
export const short = id => id.replace(/^[a-z]+:/, '').split(/[.#]/).pop()

const csParam = (name, type, refs = [], extra = {}) => ({ name, type, refs, ...extra })
const csField = (name, type, refs = [], extra = {}) => ({ name, kind: 'property', type, refs, isCollection: false, nullable: false, visibility: 'public', isStatic: false, line: 1, ...extra })
const csType = (fqn, kind, extra = {}) => {
	const name = fqn.split('.').pop()
	return {
		fqn, name, namespace: fqn.split('.').slice(0, -1).join('.'), project: 'Shop.Api', kind, file: `/src/${name}.cs`, line: 3, endLine: 20, interfaces: [], attributes: [],
		isAbstract: false, isStatic: false, typeParameters: [], fields: [], methods: [], constructorParameters: [], enumMembers: [], ...extra,
	}
}

/** What `GET /api/types` of the analyzer answers for a small shop: EF Core context, record and class DTOs, an enum, a controller with injected service. */
export function csharpResponse() {
	const N = 'Shop.Api'
	const m = (name, returnType, returnRefs, parameters = [], extra = {}) => ({ name, signature: `(${parameters.map(p => `${p.type} ${p.name}`).join(', ')}): ${returnType}`, returnType, returnRefs, parameters, visibility: 'public', isStatic: false, line: 5, endLine: 9, ...extra })
	return {
		types: [
			csType(`${N}.Data.ShopDbContext`, 'class', { baseType: 'DbContext', fields: [csField('Orders', 'DbSet<Order>', [`${N}.Data.Order`], { isCollection: false })] }),
			csType(`${N}.Data.Order`, 'class', { fields: [csField('Id', 'int'), csField('Lines', 'List<OrderLine>', [`${N}.Data.OrderLine`], { isCollection: true })] }),
			csType(`${N}.Data.OrderLine`, 'class', { fields: [csField('Sku', 'string')] }),
			csType(`${N}.Contracts.OrderDto`, 'record', { fields: [csField('Id', 'int'), csField('Status', 'OrderStatus?', [`${N}.Contracts.OrderStatus`], { nullable: true }), csField('Lines', 'IReadOnlyList<LineDto>', [`${N}.Contracts.LineDto`], { isCollection: true })] }),
			csType(`${N}.Contracts.LineDto`, 'class', { fields: [csField('Sku', 'string'), csField('Quantity', 'int')] }),
			csType(`${N}.Contracts.OrderStatus`, 'enum', { enumMembers: ['New', 'Paid'] }),
			csType(`${N}.Contracts.CreateOrderCommand`, 'class', { fields: [csField('Lines', 'List<LineDto>', [`${N}.Contracts.LineDto`], { isCollection: true })] }),
			csType(`${N}.Services.IOrderService`, 'interface', { methods: [m('Place', 'OrderDto', [`${N}.Contracts.OrderDto`], [csParam('command', 'CreateOrderCommand', [`${N}.Contracts.CreateOrderCommand`])], { isAbstract: true })] }),
			csType(`${N}.Services.OrderService`, 'class', {
				interfaces: [`${N}.Services.IOrderService`],
				constructorParameters: [csParam('db', 'ShopDbContext', [`${N}.Data.ShopDbContext`])],
				methods: [m('Place', 'OrderDto', [`${N}.Contracts.OrderDto`], [csParam('command', 'CreateOrderCommand', [`${N}.Contracts.CreateOrderCommand`])])],
			}),
			csType(`${N}.Controllers.OrdersController`, 'class', {
				baseType: 'ControllerBase', attributes: ['ApiController', 'Route'],
				constructorParameters: [csParam('orders', 'IOrderService', [`${N}.Services.IOrderService`])],
				methods: [m('Get', 'ActionResult<List<OrderDto>>', [`${N}.Contracts.OrderDto`], [], { returnIsCollection: true }), m('Post', 'ActionResult<OrderDto>', [`${N}.Contracts.OrderDto`], [csParam('command', 'CreateOrderCommand', [`${N}.Contracts.CreateOrderCommand`], { source: 'FromBody' })])],
			}),
		],
		entries: [
			{ id: 'cs:Get', controller: `${N}.Controllers.OrdersController`, action: 'Get', http: 'GET /orders', file: '/src/OrdersController.cs', line: 12, parameters: [], returnType: 'ActionResult<List<OrderDto>>', returnRefs: [`${N}.Contracts.OrderDto`], returnIsCollection: true },
			{ id: 'cs:Post', controller: `${N}.Controllers.OrdersController`, action: 'Post', http: 'POST /orders', file: '/src/OrdersController.cs', line: 18, parameters: [csParam('command', 'CreateOrderCommand', [`${N}.Contracts.CreateOrderCommand`], { source: 'FromBody' })], returnType: 'ActionResult<OrderDto>', returnRefs: [`${N}.Contracts.OrderDto`] },
		],
	}
}

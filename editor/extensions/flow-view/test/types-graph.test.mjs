// The type graph built from the code index's facts (a real index worker over small fixture projects) and from a C# analyzer response.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup } from './bundle.mjs'
import { csharpResponse, graphOf, short } from './types-helpers.mjs'

after(cleanup)

const byName = (g, name) => g.types.find(t => t.name === name)
const refsOf = (t, field) => t.fields.find(f => f.name === field)
const edge = (g, from, to, via) => g.edges.filter(e => short(e.from) === from && short(e.to) === to && (!via || e.via === via))

test('java: roles, DTOs and why', async () => {
	const g = await graphOf('java-shop')
	const role = n => byName(g, n).role
	assert.equal(role('OrderController'), 'controller')
	assert.equal(role('OrderService'), 'service')
	assert.equal(role('PricingService'), 'service')
	assert.equal(role('OrderRepository'), 'repository')
	assert.equal(role('OrderEntity'), 'entity')
	assert.equal(role('Status'), 'enum')
	assert.equal(role('StringUtils'), 'class')
	for (const n of ['OrderDto', 'AddressDto', 'OrderLineDto', 'CreateOrderRequest', 'CategoryDto', 'Money']) {
		assert.equal(byName(g, n).isDto, true, n)
	}
	assert.equal(byName(g, 'OrderDto').dtoReason, 'name suffix Dto')
	assert.equal(byName(g, 'CreateOrderRequest').dtoReason, 'name suffix Request')
	assert.equal(byName(g, 'Money').dtoReason, 'only fields and accessors')
	assert.equal(byName(g, 'OrderEntity').dtoReason, 'entity (@Entity)')
	assert.equal(byName(g, 'OrderLineDto').kind, 'record')
	assert.equal(byName(g, 'OrderService').isDto, false)
	assert.equal(byName(g, 'StringUtils').isDto, false)
})

test('java: fields resolve to ids with cardinality, wrappers unwrapped', async () => {
	const g = await graphOf('java-shop')
	const order = byName(g, 'OrderDto')
	assert.deepEqual(refsOf(order, 'address').refs.map(short), ['AddressDto'])
	assert.equal(refsOf(order, 'address').collection, 'one')
	assert.equal(refsOf(order, 'lines').collection, 'many')
	assert.equal(refsOf(order, 'status').refs.map(short)[0], 'Status')
	assert.deepEqual(refsOf(order, 'note').refs, []) // Optional<String>: nothing of the workspace in it
	assert.equal(order.fields.length, 5)
	// A record's components are its fields.
	assert.deepEqual(byName(g, 'OrderLineDto').fields.map(f => f.name), ['sku', 'quantity', 'price'])
	assert.equal(byName(g, 'Status').constants.join(), 'NEW,PAID,SHIPPED')
	// Stable ids: language and qualified name.
	assert.equal(order.id, 'java:com.acme.shop.dto.OrderDto')
	assert.equal(order.packageName, 'com.acme.shop.dto')
	assert.equal(order.module, 'java-shop')
})

test('java: cycles are edges to itself, not a loop in the builder', async () => {
	const g = await graphOf('java-shop')
	const category = byName(g, 'CategoryDto')
	assert.deepEqual(category.fields.filter(f => f.refs.length).map(f => [f.name, f.collection]), [['parent', 'one'], ['children', 'many']])
	assert.equal(edge(g, 'CategoryDto', 'CategoryDto', 'field').length, 2) // one edge per field: parent is 1, children is 0..*
	// Two entities pointing at each other.
	assert.equal(edge(g, 'OrderEntity', 'OrderLineEntity').length + edge(g, 'OrderLineEntity', 'OrderEntity').length, 2)
})

test('java: constructor injection, generic supers, method types', async () => {
	const g = await graphOf('java-shop')
	assert.deepEqual(byName(g, 'OrderService').ctorDeps.map(short), ['OrderRepository', 'PricingService'])
	assert.deepEqual(byName(g, 'OrderController').ctorDeps.map(short), ['OrderService'])
	assert.equal(edge(g, 'OrderService', 'OrderRepository', 'ctor')[0].names[0], 'repo')
	// JpaRepository<OrderEntity, Long>: the repository is about the entity.
	assert.equal(edge(g, 'OrderRepository', 'OrderEntity', 'generic').length, 1)
	const place = byName(g, 'OrderService').methods.find(m => m.name === 'place')
	assert.equal(place.signature, '(CreateOrderRequest request): OrderDto')
	assert.deepEqual(place.paramRefs.map(short), ['CreateOrderRequest'])
	assert.deepEqual(place.returnRefs.map(short), ['OrderDto'])
	assert.equal(byName(g, 'OrderService').methods.find(m => m.isConstructor).name, 'OrderService')
})

test('java: endpoints carry parameter and return types, wrappers unwrapped', async () => {
	const g = await graphOf('java-shop')
	const create = g.endpoints.find(e => e.action === 'create')
	const list = g.endpoints.find(e => e.action === 'list')
	assert.equal(create.http, 'POST /orders')
	assert.deepEqual(create.params.map(p => [p.name, p.type, p.body, p.refs.map(short)]), [['request', 'CreateOrderRequest', true, ['CreateOrderRequest']]])
	assert.equal(create.returnType, 'ResponseEntity<OrderDto>')
	assert.deepEqual(create.returnRefs.map(short), ['OrderDto'])
	assert.equal(create.returnCollection, 'one')
	assert.equal(list.returnCollection, 'many')
	assert.equal(short(create.owner), 'OrderController')
	// The service takes the DTO as a body-less parameter; only the controller's parameter is a request body.
	assert.deepEqual(byName(g, 'OrderController').methods.find(m => m.name === 'create').bodyRefs.map(short), ['CreateOrderRequest'])
})

test('typescript: interfaces, object aliases and enums of fields; promises and arrays unwrapped; DI through the constructor', async () => {
	const g = await graphOf('ts-app')
	const user = byName(g, 'UserDto')
	assert.equal(user.kind, 'interface')
	assert.equal(user.isDto, true)
	assert.equal(user.dtoReason, 'name suffix Dto')
	assert.equal(refsOf(user, 'address').collection, 'optional') // address?: AddressDto
	assert.equal(refsOf(user, 'manager').collection, 'optional') // UserDto | null
	assert.equal(refsOf(user, 'roles').collection, 'many') // Role[]
	assert.deepEqual(refsOf(user, 'tags').refs, []) // string[]
	assert.equal(byName(g, 'AddressDto').isDto, true) // an object alias
	assert.equal(byName(g, 'Role').kind, 'enum')
	assert.equal(byName(g, 'Role').constants.join(), 'Admin,Member')
	assert.equal(byName(g, 'UsersController').role, 'controller')
	assert.equal(byName(g, 'UsersService').role, 'service')
	assert.equal(byName(g, 'UsersRepository').role, 'repository')
	assert.deepEqual(byName(g, 'UsersService').ctorDeps.map(short), ['UsersRepository'])
	assert.deepEqual(byName(g, 'UsersController').ctorDeps.map(short), ['UsersService'])
	const list = g.endpoints.find(e => e.action === 'list')
	assert.equal(list.returnType, 'Promise<UserDto[]>')
	assert.equal(list.returnCollection, 'many')
	assert.deepEqual(list.returnRefs.map(short), ['UserDto'])
	const create = g.endpoints.find(e => e.action === 'create')
	assert.equal(create.params[0].body, true)
})

test('python: pydantic, dataclass, enum and entity; forward references; endpoint types', async () => {
	const g = await graphOf('py-app')
	for (const n of ['UserOut', 'ItemOut', 'Address']) {
		assert.equal(byName(g, n).dtoReason, 'BaseModel subclass', n)
	}
	assert.equal(byName(g, 'Point').dtoReason, 'dataclass')
	assert.equal(byName(g, 'Color').kind, 'enum')
	assert.equal(byName(g, 'Color').constants.join(), 'RED,BLUE')
	assert.equal(byName(g, 'Order').role, 'entity')
	assert.equal(byName(g, 'Order').isDto, false)
	const user = byName(g, 'UserOut')
	assert.equal(refsOf(user, 'address').collection, 'optional')
	assert.equal(refsOf(user, 'items').collection, 'many')
	assert.deepEqual(refsOf(user, 'friends').refs.map(short), ['UserOut']) // list["UserOut"]
	assert.equal(refsOf(user, 'friends').collection, 'many')
	const get = g.endpoints.find(e => e.action === 'get_user')
	assert.deepEqual(get.returnRefs.map(short), ['UserOut'])
	assert.deepEqual(get.params.map(p => [p.name, p.refs.length]), [['uid', 0]])
	assert.deepEqual(g.endpoints.find(e => e.action === 'add_address').params[0].refs.map(short), ['Address'])
})

test('go, rust and php: structs and classes of fields are DTOs, pointers and options are 0..1', async () => {
	const go = await graphOf('go-svc')
	const response = byName(go, 'UserResponse')
	assert.equal(response.kind, 'struct')
	assert.equal(refsOf(response, 'Addr').collection, 'optional') // *Address
	assert.equal(refsOf(response, 'Tags').collection, 'one')
	assert.equal(refsOf(response, 'Friends').collection, 'many') // []UserResponse
	assert.equal(refsOf(response, 'ByName').collection, 'many') // map[string]Address
	assert.equal(byName(go, 'Address').dtoReason, 'Go struct with only fields')
	assert.equal(byName(go, 'UserService').isDto, false)
	assert.equal(byName(go, 'UserService').methods[0].signature, '(id: int): UserResponse?')

	const rust = await graphOf('rust-app')
	assert.equal(refsOf(byName(rust, 'Customer'), 'address').collection, 'optional') // Option<Address>
	assert.equal(refsOf(byName(rust, 'Customer'), 'history').collection, 'many') // Vec<Address>
	assert.equal(byName(rust, 'Customer').isDto, true)
	assert.equal(byName(rust, 'Tier').constants.join(), 'Gold,Silver')

	const php = await graphOf('php-app')
	assert.equal(byName(php, 'ProfileResource').dtoReason, 'name suffix Resource')
	assert.equal(byName(php, 'Badge').dtoReason, 'class with only public properties')
	assert.equal(refsOf(byName(php, 'ProfileResource'), 'badge').collection, 'optional') // ?Badge
})

test('every language in one graph: ids never collide and each type keeps its own module', async () => {
	const g = await graphOf(['java-shop', 'ts-app', 'py-app', 'go-svc', 'rust-app', 'php-app'])
	assert.equal(new Set(g.types.map(t => t.id)).size, g.types.length)
	assert.deepEqual(g.modules.map(m => m.name), ['go-svc', 'java-shop', 'php-app', 'py-app', 'rust-app', 'ts-app'])
	assert.deepEqual([...new Set(g.types.map(t => t.lang))].sort(), ['go', 'java', 'js', 'php', 'python', 'rust'])
	// `Address` exists in Java (AddressDto), Python, Go and Rust: a field only resolves inside its own language.
	for (const e of g.edges) {
		assert.equal(e.from.split(':')[0], e.to.split(':')[0], `${e.from} -> ${e.to}`)
	}
	// Sorted, so a snapshot does not move.
	assert.deepEqual(g.types.map(t => t.id), [...g.types.map(t => t.id)].sort())
})

test('a custom suffix list decides which names are DTOs', async () => {
	const g = await graphOf('java-shop', { options: { dtoSuffixes: ['Request'] } })
	assert.equal(byName(g, 'CreateOrderRequest').dtoReason, 'name suffix Request')
	// OrderDto is no longer a DTO by name; it still is by its shape (nothing but fields).
	assert.equal(byName(g, 'OrderDto').dtoReason, 'only fields and accessors')
})

test('types an endpoint takes or returns become DTOs, and so do the types their fields hold', async () => {
	const g = await graphOf('java-shop')
	// OrderSummary has logic, no DTO suffix: the endpoint that returns it makes it one.
	const summary = byName(g, 'OrderSummary')
	assert.equal(summary.isDto, true)
	assert.equal(summary.role, 'dto')
	assert.equal(summary.dtoReason, 'returned by OrderController.summary')
	// Discount has logic too and no endpoint: it is a DTO because a DTO holds it.
	assert.equal(byName(g, 'Discount').isDto, true)
	assert.equal(byName(g, 'Discount').dtoReason, 'referenced by OrderSummary')
	// A class that does things and that no endpoint reaches stays a class; so does the util class.
	assert.equal(byName(g, 'StringUtils').isDto, false)
	assert.equal(byName(g, 'Status').isDto, false)
})

test('the suffix list is the only thing that makes a plain class a DTO by name', async () => {
	const g = await graphOf('java-shop', { options: { dtoSuffixes: ['Nothing'] } })
	assert.equal(byName(g, 'CreateOrderRequest').dtoReason, 'only fields and accessors')
	assert.equal(byName(g, 'OrderSummary').dtoReason, 'returned by OrderController.summary')
})

test('c#: an analyzer response alone makes a graph (no code index)', async () => {
	const g = await graphOf([], { csharp: csharpResponse() })
	const t = n => byName(g, n)
	assert.equal(t('Order').role, 'entity') // DbSet<Order>
	assert.equal(t('Order').dtoReason, 'entity (DbSet)')
	assert.equal(t('OrderLine').role, 'entity') // a type of fields that only an entity holds
	assert.equal(t('OrderLine').dtoReason, 'entity (owned by Order)')
	assert.equal(t('ShopDbContext').role, 'repository')
	assert.equal(t('OrderDto').kind, 'record')
	assert.equal(t('OrderDto').dtoReason, 'name suffix Dto')
	assert.equal(t('LineDto').isDto, true)
	assert.equal(t('CreateOrderCommand').dtoReason, 'name suffix Command')
	assert.equal(t('OrderStatus').role, 'enum')
	assert.equal(t('OrderStatus').constants.join(), 'New,Paid')
	assert.equal(t('OrdersController').role, 'controller')
	assert.equal(t('OrderService').role, 'service')
	assert.equal(t('IOrderService').role, 'service') // by its name, an interface of a service
	const dto = t('OrderDto')
	assert.equal(refsOf(dto, 'Status').collection, 'optional')
	assert.equal(refsOf(dto, 'Lines').collection, 'many')
	assert.deepEqual(refsOf(dto, 'Lines').refs.map(short), ['LineDto'])
	assert.equal(dto.id, 'csharp:Shop.Api.Contracts.OrderDto')
	assert.equal(dto.module, 'Shop.Api')
	// DI and inheritance.
	assert.deepEqual(t('OrdersController').ctorDeps.map(short), ['IOrderService'])
	assert.deepEqual(t('OrderService').ctorDeps.map(short), ['ShopDbContext'])
	assert.equal(edge(g, 'OrderService', 'IOrderService', 'implements').length, 1)
	assert.equal(t('OrderService').supers[0].relation, 'implements')
	assert.equal(edge(g, 'ShopDbContext', 'Order', 'field').length, 1)
	// Endpoints from the analyzer.
	const get = g.endpoints.find(e => e.action === 'Get')
	assert.equal(get.returnCollection, 'many')
	assert.deepEqual(get.returnRefs.map(short), ['OrderDto'])
	assert.equal(get.controller, 'OrdersController')
	const post = g.endpoints.find(e => e.action === 'Post')
	assert.deepEqual(post.params.map(p => [p.name, p.body, p.refs.map(short)]), [['command', true, ['CreateOrderCommand']]])
})

test('c# and the index in one graph', async () => {
	const g = await graphOf('java-shop', { csharp: csharpResponse() })
	assert.equal(g.types.filter(t => t.name === 'OrderDto').length, 2) // Java's and C#'s
	assert.equal(new Set(g.types.map(t => t.id)).size, g.types.length)
	assert.deepEqual(g.modules.map(m => m.name), ['Shop.Api', 'java-shop'])
})

test('no sources: an empty graph', async () => {
	const g = await graphOf([])
	assert.deepEqual([g.types, g.edges, g.endpoints, g.modules], [[], [], [], []])
})

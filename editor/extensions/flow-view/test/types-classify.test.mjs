// The type model's pure parts: reading a declared type (wrappers, collections, optionals), roles and the DTO heuristic.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, load } from './bundle.mjs'

after(cleanup)
const ref = await load('src/types/typeref.ts')
const cls = await load('src/types/classify.ts')

/** The ids a type text unwraps to, and the cardinality, with every capitalised name a workspace type. */
const unwrapOf = (text, known = ['UserDto', 'AddressDto']) => {
	const expr = ref.parseType(text)
	const leaves = ref.unwrap(expr, name => (known.includes(name) ? name : undefined))
	return { refs: leaves.map(l => l.id), card: ref.collectionOf(leaves, expr) }
}

test('wrappers and collections are seen through, in every language', () => {
	const cases = [
		['List<UserDto>', ['UserDto'], 'many'],
		['IEnumerable<UserDto>', ['UserDto'], 'many'],
		['Task<ActionResult<List<UserDto>>>', ['UserDto'], 'many'],
		['ResponseEntity<UserDto>', ['UserDto'], 'one'],
		['ResponseEntity<List<UserDto>>', ['UserDto'], 'many'],
		['Optional<UserDto>', ['UserDto'], 'optional'],
		['Promise<UserDto[]>', ['UserDto'], 'many'],
		['Observable<UserDto>', ['UserDto'], 'many'],
		['Array<UserDto>', ['UserDto'], 'many'],
		['UserDto[]', ['UserDto'], 'many'],
		['UserDto?', ['UserDto'], 'optional'],
		['UserDto | null', ['UserDto'], 'optional'],
		['Optional[UserDto]', ['UserDto'], 'optional'],
		['list[UserDto]', ['UserDto'], 'many'],
		['Dict[str, UserDto]', ['UserDto'], 'many'],
		['Map<String, List<UserDto>>', ['UserDto'], 'many'],
		['Vec<UserDto>', ['UserDto'], 'many'],
		['Mono<UserDto>', ['UserDto'], 'one'],
		['Flux<UserDto>', ['UserDto'], 'many'],
		['IActionResult', [], 'one'],
		['void', [], 'optional'],
		['String', [], 'one'],
	]
	for (const [text, refs, card] of cases) {
		assert.deepEqual(unwrapOf(text), { refs, card }, text)
	}
})

test('a framework generic that is not a wrapper still shows the workspace types inside it', () => {
	assert.deepEqual(unwrapOf('ApiResponse<UserDto>').refs, ['UserDto'])
	assert.deepEqual(unwrapOf('Page<UserDto>'), { refs: ['UserDto'], card: 'many' })
	// A generic the workspace declares itself is a type too, with what it holds.
	assert.deepEqual(unwrapOf('Envelope<UserDto>', ['Envelope', 'UserDto']).refs, ['Envelope', 'UserDto'])
	assert.deepEqual(unwrapOf('Foo<Bar<Baz>>').refs, [])
})

test('what the parser cannot read is opaque, never an error', () => {
	for (const text of ['', undefined, '{ a: number }', '(x: number) => void', '<<<', 'List<', '[A, B]']) {
		assert.doesNotThrow(() => ref.parseType(text), String(text))
	}
	assert.equal(ref.displayType('java.util.List<com.acme.UserDto>'), 'List<UserDto>')
})

const facts = (over = {}) => ({
	name: 'Thing', kind: 'class', lang: 'java', isAbstract: false, annotations: [], supers: [], fields: [], methods: [], injects: false, hasEndpoints: false, mappedEntity: false, ...over,
})
const field = name => ({ name, visibility: '-', isStatic: false })

test('roles: annotations and base types decide before names, an entity before everything', () => {
	const role = over => cls.roleOf(facts(over))
	assert.equal(role({ name: 'OrderController' }), 'controller')
	assert.equal(role({ name: 'Orders', annotations: ['RestController'] }), 'controller')
	assert.equal(role({ name: 'Orders', supers: ['ControllerBase'], lang: 'csharp' }), 'controller')
	assert.equal(role({ name: 'Orders', hasEndpoints: true }), 'controller')
	assert.equal(role({ name: 'OrderService' }), 'service')
	assert.equal(role({ name: 'Orders', annotations: ['Service'] }), 'service')
	assert.equal(role({ name: 'OrderRepository', kind: 'interface' }), 'repository')
	assert.equal(role({ name: 'Orders', supers: ['JpaRepository'], kind: 'interface' }), 'repository')
	assert.equal(role({ name: 'ShopDbContext', supers: ['DbContext'], lang: 'csharp' }), 'repository')
	assert.equal(role({ name: 'OrderCreatedHandler' }), 'handler')
	assert.equal(role({ name: 'Orders', supers: ['IRequestHandler'], lang: 'csharp' }), 'handler')
	assert.equal(role({ name: 'OrderService', annotations: ['Entity'] }), 'entity')
	assert.equal(role({ name: 'Order', mappedEntity: true, lang: 'csharp' }), 'entity')
	assert.equal(role({ name: 'Order', supers: ['Model'], lang: 'python' }), 'entity')
	assert.equal(role({ name: 'Order', supers: ['Base'], lang: 'python', ormFields: true }), 'entity')
	assert.equal(role({ name: 'Base', supers: ['Base'], lang: 'python' }), 'class')
	assert.equal(role({ name: 'Status', kind: 'enum' }), 'enum')
	assert.equal(role({ name: 'Auditable', kind: 'interface' }), 'interface')
	assert.equal(role({ name: 'Money' }), 'class')
	assert.equal(role({ name: 'Service' }), 'service')
	assert.equal(role({ name: 'Subservice2' }), 'class')
})

test('DTO suffixes: the configured list, longest first, on a word boundary', () => {
	const suffixes = cls.DEFAULT_DTO_SUFFIXES
	for (const name of ['UserDto', 'UserDTO', 'CreateUserRequest', 'UserResponse', 'PlaceOrderCommand', 'FindUsersQuery', 'SearchResult', 'UserModel', 'UserViewModel', 'LoginPayload', 'UserInput', 'UserOutput', 'ListParams', 'MainArgs', 'UserCreatedEvent', 'ChatMessage', 'UserResource', 'ProfileVm', 'Dto', 'Event']) {
		assert.ok(cls.dtoSuffix(name, suffixes), name)
	}
	assert.equal(cls.dtoSuffix('UserViewModel', suffixes), 'ViewModel')
	for (const name of ['Order', 'Paddress', 'Request2', 'Dtox']) {
		assert.equal(cls.dtoSuffix(name, suffixes), undefined, name)
	}
	assert.equal(cls.dtoSuffix('OrderRow', ['Row']), 'Row')
})

test('DTO shapes per language', () => {
	const shape = over => cls.dataShape(facts(over))
	assert.equal(shape({ kind: 'record' }), 'record')
	assert.equal(shape({ annotations: ['Data'] }), '@Data')
	assert.equal(shape({ annotations: ['Value'] }), '@Value')
	assert.equal(shape({ lang: 'python', supers: ['BaseModel'] }), 'BaseModel subclass')
	assert.equal(shape({ lang: 'python', annotations: ['dataclass'] }), 'dataclass')
	assert.equal(shape({ lang: 'python', supers: ['TypedDict'] }), 'TypedDict')
	assert.equal(shape({ lang: 'js', kind: 'interface', fields: [field('id')] }), 'TS interface of fields')
	assert.equal(shape({ lang: 'js', kind: 'interface', alias: true, fields: [field('id')] }), 'type alias of an object')
	assert.equal(shape({ lang: 'js', kind: 'interface', fields: [field('id')], methods: ['save'] }), undefined)
	assert.equal(shape({ lang: 'go', kind: 'struct', fields: [field('ID')] }), 'Go struct with only fields')
	assert.equal(shape({ lang: 'go', kind: 'struct', fields: [field('ID')], methods: ['Save'] }), undefined)
	assert.equal(shape({ lang: 'rust', kind: 'struct', fields: [field('id')] }), 'Rust struct with only fields')
	assert.equal(shape({ lang: 'php', fields: [{ name: 'a', visibility: '+', isStatic: false }] }), 'class with only public properties')
	assert.equal(shape({ lang: 'php', fields: [field('a')] }), undefined)
	assert.equal(shape({ fields: [field('a')], methods: ['getA', 'setA', 'toString', 'equals'] }), 'only fields and accessors')
	assert.equal(shape({ fields: [field('a')], methods: ['calculate'] }), undefined)
	assert.equal(shape({ fields: [field('a')], injects: true }), undefined)
	assert.equal(shape({ kind: 'enum', fields: [field('a')] }), undefined)
	assert.equal(shape({ kind: 'interface', fields: [field('a')] }), undefined)
})

test('services, controllers and entities are never DTOs by name or shape', () => {
	const opts = cls.classifyOptions()
	assert.equal(cls.dtoOwnReason(facts({ name: 'UserDto' }), 'dto', opts), 'name suffix Dto')
	assert.equal(cls.dtoOwnReason(facts({ name: 'UserEventHandler' }), 'handler', opts), undefined)
	assert.equal(cls.dtoOwnReason(facts({ name: 'UserResponseService' }), 'service', opts), undefined)
	assert.equal(cls.dtoOwnReason(facts({ name: 'OrderDto', annotations: ['Entity'] }), 'entity', opts), undefined)
	assert.equal(cls.dtoOwnReason(facts({ name: 'Status', kind: 'enum' }), 'enum', opts), undefined)
	assert.equal(cls.dtoOwnReason(facts({ name: 'Money', fields: [field('a')], methods: ['multiply'] }), 'class', opts), undefined)
})

test('options: settings are checked, bad values fall back to the defaults', () => {
	assert.deepEqual(cls.classifyOptions(), { dtoSuffixes: [...cls.DEFAULT_DTO_SUFFIXES], includeEntities: false, includeEnums: true })
	const custom = cls.classifyOptions({ dtoSuffixes: ['Row', 'bad name', 7], includeEntities: true, includeEnums: 'yes' })
	assert.deepEqual(custom, { dtoSuffixes: ['Row'], includeEntities: true, includeEnums: true })
	assert.deepEqual(cls.classifyOptions({ dtoSuffixes: [] }).dtoSuffixes, [...cls.DEFAULT_DTO_SUFFIXES])
})

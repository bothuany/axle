// Boards generated from code (src/board/fromCode): sequence from a traced flow, ER from the entity readers, architecture from the type graph, state from an
// enum and the methods that move it. Each generator runs on real fixture projects through the polyglot index worker (Java, TypeScript, Python) and on a
// hand-written C# analyzer response; the golden files pin the board a fixture produces. Also: guesses are marked, sizes are capped, a scope that does not
// fit its kind is refused, and an agent's notes never add a node.
// After an intended change: UPDATE=1 node --test test/board-from-code.test.mjs, then read the diff of test/fromcode-expected.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Index, ROOT } from './helpers.mjs'
import { cleanup, load } from './bundle.mjs'
import { csharpResponse } from './types-helpers.mjs'

after(cleanup)

const FIXTURES = join(ROOT, 'test', 'fromcode-fixtures')
const EXPECTED = join(ROOT, 'test', 'fromcode-expected')
const gen = await load('src/board/fromCode/index.ts')
const { buildTypeGraph } = await load('src/types/graph.ts')
const { nearestServiceResolver } = await load('src/types/service.ts')

/** A fixture through the real index worker: entry points with their flows, the schemas, the type graph. */
const opened = new Map()
function open(name) {
	if (!opened.has(name)) {
		opened.set(name, (async () => {
			const dir = join(FIXTURES, name)
			const index = new Index(dir)
			try {
				await index.ready
				const entries = await index.request('entries')
				const flows = new Map()
				for (const e of entries) {
					flows.set(e.id, await index.graph(e.id, 8))
				}
				const schemas = await index.request('schemas')
				const poly = await index.request('typeFacts')
				const graph = buildTypeGraph({ poly, moduleOf: nearestServiceResolver([dir]) })
				return { dir, entries, flows, schemas, graph }
			} finally {
				await index.close()
			}
		})())
	}
	return opened.get(name)
}

const flowOf = (fx, http) => {
	const e = fx.entries.find(x => x.http === http)
	assert.ok(e, `${http} is not an entry point of the fixture: ${fx.entries.map(x => x.http).join(', ')}`)
	return fx.flows.get(e.id)
}

/** A board as stable text: ids, symbols, places relative to the fixture, edges in order, then what the generator said. */
function dump(fx, out) {
	assert.ok(out.board, `no board: ${out.skipped}`)
	const b = out.board
	const rel = f => f ? relative(fx.dir, f).replace(/\\/g, '/') : ''
	const lines = [`${b.kind}${b.level ? ` (${b.level})` : ''}: ${b.title}`, b.description ?? '', `direction ${b.direction ?? '-'}${b.focus ? `, focus ${b.focus}` : ''}`, '', 'nodes:']
	for (const n of b.nodes) {
		lines.push(`  ${n.id} | ${n.label} | ${n.kind}${n.shape ? `/${n.shape}` : ''} | symbol ${n.symbol ?? '-'} | ${rel(n.file)}${n.line ? `:${n.line}` : ''}${n.group ? ` | group ${n.group}` : ''}${n.tech ? ` | tech ${n.tech}` : ''}${n.detail ? ` | ${n.detail}` : ''}`)
		for (const m of n.members ?? []) {
			lines.push(`      ${m.text}${m.ref ? ` -> ${m.ref}` : ''}`)
		}
	}
	lines.push('edges:')
	for (const e of b.edges) {
		lines.push(`  ${e.order ? `${e.order}. ` : ''}${e.from} -> ${e.to} [${e.kind ?? '-'}${e.style ? `, ${e.style}` : ''}${e.async ? ', async' : ''}]${e.label ? ` ${e.label}` : ''}${e.fromCard || e.toCard ? ` (${e.fromCard ?? ''} : ${e.toCard ?? ''})` : ''}`)
	}
	if (b.groups?.length) {
		lines.push('groups:', ...b.groups.map(g => `  ${g.id} | ${g.label}${g.kind ? ` | ${g.kind}` : ''}${g.parent ? ` | in ${g.parent}` : ''}${g.collapsed ? ' | collapsed' : ''}${g.tech ? ` | ${g.tech}` : ''}`))
	}
	if (b.legend?.length) {
		lines.push('legend:', ...b.legend.map(l => `  ${l.key}: ${l.text}`))
	}
	lines.push('notes:', ...out.notes.map(n => `  - ${n.replace(/\\/g, '/').replaceAll(fx.dir.replace(/\\/g, '/'), '<fixture>')}`))
	return lines.join('\n')
}

function golden(name, text) {
	const file = join(EXPECTED, `${name}.txt`)
	if (process.env.UPDATE) {
		mkdirSync(EXPECTED, { recursive: true })
		writeFileSync(file, text + '\n')
		return
	}
	assert.ok(existsSync(file), `no golden file ${name}: run UPDATE=1 node --test test/board-from-code.test.mjs and read test/fromcode-expected/${name}.txt`)
	assert.equal(text + '\n', readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
}

// ---- sequence ------------------------------------------------------------------------------------------------------------------------------------

for (const [name, http] of [['java-orders', 'POST /orders'], ['ts-orders', 'POST /orders/pay'], ['py-orders', 'POST /orders/{order_id}/pay']]) {
	test(`sequence from a flow: ${name} ${http}`, async () => {
		const fx = await open(name)
		const out = gen.sequenceFromFlow(flowOf(fx, http), `Sequence: ${http}`, { rel: f => relative(fx.dir, f).replace(/\\/g, '/') })
		golden(`sequence-${name}`, dump(fx, out))
		const b = out.board
		assert.deepEqual(b.edges.map(e => e.order), b.edges.map((_, i) => i + 1), 'messages are numbered from 1 in order')
		for (const n of b.nodes.filter(n => n.id !== 'client')) {
			assert.ok(n.symbol, `${n.id} has a symbol`)
		}
	})
}

const call = (label, kind, children = [], extra = {}) => ({ key: label, symbolId: null, label, sub: '', kind, file: `/w/${label.split('.')[0]}.java`, startLine: 5, endLine: 9, code: null, children, ...extra })
const edge = (node, edgeKind = 'call', callLine = 1, guess = false) => ({ callLine, edgeKind, node, ...(guess ? { guess } : {}) })

test('sequence: HTTP, topic, mediator and name-only hops are dotted and marked as guesses; certain calls are not', () => {
	const root = call('Api.place', 'controller', [
		edge(call('Svc.run', 'method', [edge(call('Repo.save', 'method'), 'call', 3)]), 'call', 1),
		edge(call('Billing.charge', 'controller'), 'http', 2),
		edge(call('Events.onPlaced', 'controller'), 'message', 4),
		edge(call('Handler.handle', 'method'), 'mediator', 5),
		edge(call('Util.fmt', 'method'), 'call', 6, true),
	], { sub: 'POST /place' })
	const out = gen.sequenceFromFlow(root, 'guesses')
	const labels = out.board.edges.map(e => `${e.order} ${e.label} ${e.style ?? 'solid'}${e.async ? ' async' : ''}`)
	assert.deepEqual(labels, ['1 POST /place solid', '2 run solid', '3 save solid', '4 HTTP? charge dotted', '5 topic? onPlaced dotted async', '6 mediator? handle dotted', '7 ? fmt dotted'])
	assert.equal(out.board.edges.filter(e => e.style === 'dotted').length, 4)
	assert.ok(out.board.legend.some(l => l.key === 'guess'))
	assert.ok(out.notes.some(n => /4 message\(s\) are guesses/.test(n)))
})

test('sequence: calls come out in line order, not in the order the index listed them', () => {
	const root = call('A.run', 'method', [edge(call('C.third', 'method'), 'call', 30), edge(call('B.first', 'method'), 'call', 10), edge(call('D.second', 'method'), 'call', 20)])
	assert.deepEqual(gen.sequenceFromFlow(root, 't').board.edges.map(e => e.label), ['first', 'second', 'third'])
})

test('sequence: size caps keep a readable diagram and say what was cut', () => {
	const kids = Array.from({ length: 12 }, (_, i) => edge(call(`Svc${i}.go`, 'method'), 'call', i + 1))
	const root = call('Api.run', 'method', kids)
	const lifelines = gen.sequenceFromFlow(root, 't', { maxParticipants: 4 })
	assert.equal(lifelines.board.nodes.length, 4)
	assert.ok(lifelines.notes.some(n => /9 call\(s\) into further participants were left out.*at most 4 lifelines/.test(n)))
	const messages = gen.sequenceFromFlow(root, 't', { maxMessages: 5 })
	assert.equal(messages.board.edges.length, 5)
	assert.ok(messages.notes.some(n => /7 call\(s\) were left out.*at most 5 messages/.test(n)))
	const deep = call('A.a', 'method', [edge(call('B.b', 'method', [edge(call('C.c', 'method', [edge(call('D.d', 'method'))]))]))])
	const shallow = gen.sequenceFromFlow(deep, 't', { depth: 1 })
	assert.equal(shallow.board.edges.length, 1)
	assert.ok(shallow.notes.some(n => /B\.b makes 1 deeper call\(s\)/.test(n)))
})

test('sequence: a method that calls nothing the index can follow is skipped with a reason', () => {
	const out = gen.sequenceFromFlow(call('A.leaf', 'method'), 't')
	assert.equal(out.board, undefined)
	assert.match(out.skipped, /makes no call the index can follow/)
})

test('sequence: a table is a participant, with writes or reads and a guessed table marked', () => {
	const db = (label, writes) => call(label, 'db', [], { file: null, startLine: 0, schema: { entity: label, table: label, writes, ops: ['save'], file: `/w/${label}.java`, line: 3, columns: [], relations: [] } })
	const root = call('Svc.run', 'method', [edge(db('orders', true), 'db', 1), edge(db('audit', false), 'db', 2, true)])
	const out = gen.sequenceFromFlow(root, 't')
	assert.deepEqual(out.board.edges.map(e => `${e.kind} ${e.label} ${e.style ?? ''}`.trim()), ['writes writes save', 'reads reads save ? dotted'])
	assert.equal(out.board.nodes.find(n => n.id === 'orders').shape, 'cylinder')
})

// ---- ER ------------------------------------------------------------------------------------------------------------------------------------------

for (const name of ['java-orders', 'ts-orders', 'py-orders']) {
	test(`ER from the entity readers: ${name}`, async () => {
		const fx = await open(name)
		const out = gen.erFromTables({ schemas: fx.schemas, graph: fx.graph })
		golden(`er-${name}`, dump(fx, out))
		for (const n of out.board.nodes) {
			assert.ok(n.symbol && n.file && n.line, `${n.id}: symbol, file and line come from the index`)
		}
	})
}

test('ER: a relation is drawn once, from the end that holds the foreign key, with cardinality and PK/FK on the columns', async () => {
	const fx = await open('java-orders')
	const b = gen.erFromTables({ schemas: fx.schemas, graph: fx.graph }).board
	const order = b.nodes.find(n => n.label === 'orders')
	assert.deepEqual(b.edges.filter(e => e.from === 't_orders' || e.to === 't_orders').map(e => `${e.from}->${e.to} ${e.fromCard}:${e.toCard} ${e.label}`).sort(), ['t_order_lines->t_orders 0..*:1 order / lines', 't_orders->t_customers 0..*:1 customer / orders'])
	assert.ok(order.members.some(m => /^id: Long {2}PK$/.test(m.text)))
	assert.ok(order.members.some(m => /^customer: Customer {2}FK$/.test(m.text) && m.ref === 't_customers'))
	assert.equal(b.edges.length, 2)
})

test('ER: asking for a table draws it and its neighbours; an unknown name is reported, a total miss is a reason', async () => {
	const fx = await open('java-orders')
	const some = gen.erFromTables({ schemas: fx.schemas, graph: fx.graph }, { tables: ['order_lines', 'nope'] })
	assert.deepEqual(some.board.nodes.map(n => n.label).sort(), ['order_lines', 'orders'])
	assert.equal(some.board.focus, 't_order_lines', 'one table found: it is the focus')
	assert.ok(some.notes.some(n => /No table or entity named "nope"/.test(n)))
	const one = gen.erFromTables({ schemas: fx.schemas, graph: fx.graph }, { tables: ['Customer'] })
	assert.equal(one.board.focus, 't_customers', 'an entity name finds its table')
	const none = gen.erFromTables({ schemas: fx.schemas, graph: fx.graph }, { tables: ['missing'] })
	assert.equal(none.board, undefined)
	assert.match(none.skipped, /No table or entity named "missing"\. Tables: customers, order_lines, orders/)
})

test('ER: the size cap keeps the most connected and the asked-for tables, and says so', async () => {
	const fx = await open('java-orders')
	const out = gen.erFromTables({ schemas: fx.schemas, graph: fx.graph }, {}, { maxTables: 2 })
	assert.equal(out.board.nodes.length, 2)
	assert.ok(out.board.nodes.some(n => n.label === 'orders'), 'the hub table stays')
	assert.ok(out.notes.some(n => /Showing 2 of 3 tables/.test(n)))
	const asked = gen.erFromTables({ schemas: fx.schemas, graph: fx.graph }, { tables: ['customers'] }, { maxTables: 2 })
	assert.ok(asked.board.nodes.some(n => n.label === 'customers'), 'an asked-for table is never cut')
	const wide = gen.erFromTables({ schemas: [{ ...fx.schemas[0], columns: Array.from({ length: 50 }, (_, i) => ({ name: `c${i}`, column: `c${i}`, type: 'int', key: false, nullable: true, maxLength: null })) }] }, {}, { maxColumns: 5 })
	assert.equal(wide.board.nodes[0].members.length, 6)
	assert.match(wide.board.nodes[0].members[5].text, /45 more columns/)
})

test('ER: with no entity or migration at all there is a reason, not an empty board', () => {
	const out = gen.erFromTables({ schemas: [] })
	assert.equal(out.board, undefined)
	assert.match(out.skipped, /found no entity, ORM model or migration/)
})

test('ER: a table only a migration declares is drawn from the migration and says so', () => {
	const migration = { format: 'sql', name: 'V1__init', file: '/w/db/V1__init.sql', notes: [], ops: [{ table: 'legacy_ref', op: 'create', columns: ['id', 'code'], line: 4 }] }
	const out = gen.erFromTables({ schemas: [], migrations: [migration] })
	const n = out.board.nodes[0]
	assert.equal(n.label, 'legacy_ref')
	assert.equal(n.symbol, undefined, 'no entity, so no symbol is invented')
	assert.equal(n.file, '/w/db/V1__init.sql')
	assert.equal(n.line, 4)
	assert.deepEqual(n.members.map(m => m.text), ['id', 'code'])
	assert.match(n.detail, /declared by migration V1__init; no entity found/)
	assert.ok(out.notes.some(x => /declared only by a migration/.test(x)))
})

test('ER: C# entities, which the analyzer reads without columns, come from their fields and are marked as guesses', async () => {
	const { graphOf } = await import('./types-helpers.mjs')
	const graph = await graphOf([], { csharp: csharpResponse() })
	const out = gen.erFromTables({ schemas: [], graph })
	const order = out.board.nodes.find(n => n.symbol === 'Order')
	assert.ok(order)
	assert.match(order.detail, /table name guessed · columns from fields/)
	assert.ok(order.members.some(m => /^Id: int {2}PK$/.test(m.text)))
	assert.ok(out.board.edges.every(e => e.style === 'dotted'), 'relations without an ORM reader are guesses')
	assert.ok(out.board.legend.some(l => l.key === 'guess'))
	assert.ok(out.notes.some(n => /come from entity fields, not an ORM reader/.test(n)))
})

// ---- architecture --------------------------------------------------------------------------------------------------------------------------------

async function graphs(names) {
	const { polyFacts } = await import('./types-helpers.mjs')
	const { FIXTURES: TYPES } = await import('./types-helpers.mjs')
	const all = await Promise.all(names.map(polyFacts))
	return buildTypeGraph({ poly: { files: all.flatMap(f => f.files), calls: all.flatMap(f => f.calls), entries: all.flatMap(f => f.entries) }, moduleOf: nearestServiceResolver(names.map(n => join(TYPES, n))) })
}
const archFx = dir => ({ dir: join(ROOT, 'test', 'types-fixtures', dir) })

test('architecture: several services are the C4 container level, one boundary around them, dependencies counted', async () => {
	const graph = await graphs(['java-shop', 'ts-app', 'py-app'])
	const out = gen.architectureFromGraph(graph)
	golden('architecture-containers', dump(archFx('java-shop'), out))
	assert.equal(out.board.level, 'container')
	assert.deepEqual(out.board.groups.map(g => g.kind), ['boundary'])
	assert.ok(out.board.nodes.every(n => n.tech && n.group === 'system'))
})

test('architecture: one service is the component level (its packages); a module asked for opens its packages', async () => {
	const one = gen.architectureFromGraph(await graphs(['java-shop']))
	golden('architecture-components', dump(archFx('java-shop'), one))
	assert.equal(one.board.level, 'component')
	const several = await graphs(['java-shop', 'ts-app'])
	const module = gen.architectureFromGraph(several, { module: 'java-shop' })
	assert.equal(module.board.level, 'component')
	assert.equal(module.board.title, 'Architecture: java-shop')
	assert.ok(module.board.nodes.every(n => n.kind === 'external' || n.group))
	const missing = gen.architectureFromGraph(several, { module: 'nothing-like-this' })
	assert.equal(missing.board, undefined)
	assert.match(missing.skipped, /No module or package named "nothing-like-this"\. Modules: java-shop, ts-app/)
})

test('architecture: the box cap keeps the most connected and says how to see the rest', async () => {
	const graph = await graphs(['java-shop'])
	const out = gen.architectureFromGraph(graph, {}, { maxNodes: 3 })
	assert.equal(out.board.nodes.length, 3)
	assert.ok(out.notes.some(n => /Showing 3 of \d+ boxes/.test(n)))
	assert.ok(out.board.description.includes('more not shown'))
})

test('architecture: an empty graph is a reason', () => {
	const out = gen.architectureFromGraph(buildTypeGraph({}))
	assert.equal(out.board, undefined)
	assert.match(out.skipped, /type graph is empty/)
})

test('architecture: services that depend on each other are boxes with counted edges inside one boundary, with the technology of each', () => {
	const t = (module, name, lang, role = 'service') => ({ id: `${lang}:${module}.${name}`, name, qualifiedName: `${module}.${name}`, kind: 'class', lang, file: `/w/${module}/${name}`, line: 1, endLine: 2, module, packageName: module, role, isDto: false, dtoReason: '', isAbstract: false, supers: [], typeParams: [], annotations: [], fields: [], methods: [], ctorDeps: [] })
	const types = [t('orders', 'OrderApi', 'java', 'controller'), t('orders', 'OrderSvc', 'java'), t('billing', 'Invoicer', 'csharp'), t('users', 'UserSvc', 'js'), t('mail', 'Mailer', 'python')]
	const id = n => types.find(x => x.name === n).id
	const graph = {
		types, byId: new Map(types.map(x => [x.id, x])), modules: [], endpoints: [], funcs: [], options: {},
		edges: [{ from: id('OrderApi'), to: id('OrderSvc'), via: 'ctor', names: ['svc'], collection: 'one' }, { from: id('OrderSvc'), to: id('Invoicer'), via: 'field', names: ['invoicer'], collection: 'one' }, { from: id('OrderSvc'), to: id('UserSvc'), via: 'method', names: ['load'], collection: 'one' }, { from: id('Invoicer'), to: id('Mailer'), via: 'field', names: ['mail'], collection: 'one' }],
		calls: [{ from: id('OrderSvc'), to: id('Invoicer'), count: 3 }],
	}
	const out = gen.architectureFromGraph(graph)
	assert.equal(out.board.level, 'container')
	assert.deepEqual(out.board.edges.map(e => `${e.from}->${e.to} ${e.label}`), ['u_billing->u_mail 1 ref', 'u_orders->u_billing 1 ref, 3 calls', 'u_orders->u_users 1 ref'])
	assert.deepEqual(out.board.nodes.map(n => `${n.label}:${n.tech}`), ['billing:C#', 'mail:Python', 'orders:Java', 'users:JavaScript/TypeScript'])
	assert.equal(out.board.nodes.find(n => n.label === 'orders').detail, '2 types: 1 controller, 1 service')
	golden('architecture-synthetic', dump({ dir: '/w' }, out))
	const capped = gen.architectureFromGraph(graph, {}, { maxNodes: 2 })
	assert.equal(capped.board.nodes.length, 2)
	assert.ok(capped.board.nodes.some(n => n.label === 'orders'), 'the most connected box stays')
	const focus = gen.architectureFromGraph(graph, { module: 'orders' })
	assert.equal(focus.board.level, 'component')
	assert.deepEqual(focus.board.nodes.map(n => `${n.label}:${n.kind}`), ['billing:external', 'users:external', 'orders:service'])
})

// ---- state ---------------------------------------------------------------------------------------------------------------------------------------

for (const [name, enumName] of [['java-orders', 'OrderStatus'], ['ts-orders', 'OrderStatus'], ['py-orders', 'OrderStatus']]) {
	test(`state from an enum and its guarded transitions: ${name}`, async () => {
		const fx = await open(name)
		const out = gen.stateFromEnum({ graph: fx.graph, readSource: f => existsSync(f) ? readFileSync(f, 'utf8') : undefined }, { enum: enumName })
		golden(`state-${name}`, dump(fx, out))
		assert.ok(out.board.edges.length >= 1)
		for (const n of out.board.nodes.filter(n => n.id !== '_start')) {
			assert.ok(n.symbol && n.file && n.line)
		}
	})
}

test('state: only a clear transition is drawn: unguarded assignments and ambiguous methods are listed, not drawn', async () => {
	const fx = await open('java-orders')
	const read = f => readFileSync(f, 'utf8')
	const out = gen.stateFromEnum({ graph: fx.graph, readSource: read }, { enum: 'OrderStatus' })
	assert.deepEqual(out.board.edges.filter(e => e.from !== '_start').map(e => `${e.from}->${e.to}`).sort(), ['NEW->CANCELLED', 'NEW->PAID', 'PAID->SHIPPED'])
	assert.deepEqual(out.board.edges.filter(e => e.from === '_start').map(e => e.to), ['NEW'], 'the field initialiser is the initial state')
	assert.ok(out.notes.some(n => /1 assignment\(s\) were not drawn because the method does not check the state it comes from: OrderService\.reopen -> NEW/.test(n)))
	assert.ok(out.notes.some(n => /No clear transition into or out of: ARCHIVED/.test(n)))
	// The same code with the guards removed has no clear transition: the answer is a reason.
	const bare = gen.stateFromEnum({ graph: fx.graph, readSource: f => read(f).replace(/if \(order\.getStatus\(\)[^\n]*\n/g, '') }, { enum: 'OrderStatus' })
	assert.equal(bare.board, undefined)
	assert.match(bare.skipped, /no transition is clear in the code.*without such a check/s)
})

test('state: an enum nothing moves, an unknown enum and no enum are skipped with a reason', async () => {
	const java = await graphs(['java-shop'])
	const none = gen.stateFromEnum({ graph: java, readSource: () => undefined })
	assert.equal(none.board, undefined)
	assert.match(none.skipped, /no transition is clear|No enum with two or more values/)
	const unknown = gen.stateFromEnum({ graph: java, readSource: () => undefined }, { enum: 'Nope' })
	assert.match(unknown.skipped, /No enum "Nope" with two or more values\. Enums used as a field type:/)
	const empty = gen.stateFromEnum({ graph: buildTypeGraph({}), readSource: () => undefined })
	assert.match(empty.skipped, /No enum with two or more values is used as a field type/)
})

test('state: the enum is named by simple name, qualified name, or Owner.field (the owner qualified or not)', async () => {
	const fx = await open('java-orders')
	const read = f => readFileSync(f, 'utf8')
	for (const name of ['OrderStatus', 'com.acme.OrderStatus', 'Order.status', 'com.acme.Order.status']) {
		const out = gen.stateFromEnum({ graph: fx.graph, readSource: read }, { enum: name })
		assert.equal(out.board?.title, 'States: OrderStatus', name)
	}
	const py = await open('py-orders')
	const pyName = py.graph.types.find(t => t.name === 'OrderStatus').qualifiedName
	assert.ok(pyName.includes('.'), pyName)
	assert.equal(gen.stateFromEnum({ graph: py.graph, readSource: read }, { enum: pyName }).board?.title, 'States: OrderStatus', pyName)
	assert.match(gen.stateFromEnum({ graph: fx.graph, readSource: read }, { enum: 'com.acme.Nope' }).skipped, /No enum "com\.acme\.Nope"/)
	assert.match(gen.stateFromEnum({ graph: fx.graph, readSource: read }, { enum: 'Order.nope' }).skipped, /No enum "Order\.nope"/)
})

test('state: with no enum named, the one with clear transitions is found', async () => {
	const fx = await open('java-orders')
	const out = gen.stateFromEnum({ graph: fx.graph, readSource: f => readFileSync(f, 'utf8') })
	assert.equal(out.board.title, 'States: OrderStatus')
})

// ---- scope, annotations ---------------------------------------------------------------------------------------------------------------------------

test('a scope that does not fit its kind is refused with the kind it fits', () => {
	assert.throws(() => gen.checkScope('er', { module: 'x' }), /kind "er" takes a set of tables.*scope\.module does not fit it \(it fits kind "architecture"\)/)
	assert.throws(() => gen.checkScope('sequence', {}), /kind "sequence" needs a scope/)
	assert.throws(() => gen.checkScope('flow', {}), /`kind` must be one of: sequence, er, architecture, state/)
	assert.throws(() => gen.checkScope('state', 'x'), /`scope` must be an object/)
	assert.deepEqual(gen.checkScope('er', undefined), { kind: 'er', scope: {} })
	assert.deepEqual(gen.checkScope('sequence', { id: 'poly:x', file: undefined }).scope, { id: 'poly:x', file: undefined })
	assert.deepEqual(gen.strings(['a', ' b ', ''], 'x'), ['a', 'b'])
	assert.throws(() => gen.strings([1], 'scope.tables'), /scope\.tables must be a list of strings/)
})

test('annotations add titles and notes, never nodes: a note for a node that is not there is reported', async () => {
	const fx = await open('java-orders')
	const board = gen.erFromTables({ schemas: fx.schemas, graph: fx.graph }).board
	const before = board.nodes.length
	const warnings = gen.annotate(board, { title: 'Order domain', description: 'Why: billing review', notes: [{ node: 'Order', text: 'Owns the status' }, { node: 't_customers', text: 'Soft deleted' }, { node: 'Ghost', text: 'invented' }, { node: 7 }] })
	assert.equal(board.title, 'Order domain')
	assert.ok(board.description.startsWith('Why: billing review'))
	assert.equal(board.nodes.length, before, 'no node was added')
	assert.equal(board.nodes.find(n => n.symbol === 'Order').note, 'Owns the status', 'a note finds its node by symbol')
	assert.equal(board.nodes.find(n => n.id === 't_customers').note, 'Soft deleted', 'or by id')
	assert.equal(warnings.length, 2)
	assert.match(warnings[0], /Note for "Ghost" was dropped: no node has that id, symbol or label/)
	assert.deepEqual(gen.annotate(board, { notes: 'oops' }), ['`notes` must be an array of {node, text}; it was ignored.'])
})

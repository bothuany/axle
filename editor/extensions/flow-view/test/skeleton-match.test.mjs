// Skeleton first: the plan an agent drew against the types written for it, per language. One checkout design, written in
// Java, TypeScript, Python and C# with the same deliberate slips: DiscountPolicy is a class where the plan has an interface,
// checkout takes one parameter instead of two, Receipt is called ReceiptDto, OrderLine.quantity is called qty, and
// OrderRepository is not written at all.
// After an intended change to the text: UPDATE=1 node --test test/skeleton-match.test.mjs, then read the diff of test/skeleton-expected.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { cleanup, load } from './bundle.mjs'
import { ROOT } from './helpers.mjs'
import { FIXTURES, graphOf } from './types-helpers.mjs'

after(cleanup)

const match = await load('src/skeleton/match.ts')
const spec = await load('src/board/spec.ts')

/** The design an agent would draw for "add discounts to checkout". */
const PLAN = spec.parseBoard({
	kind: 'class',
	title: 'Checkout with discounts',
	nodes: [
		{ id: 'order', label: 'Order', kind: 'entity', members: [{ text: 'id: Long' }, { text: 'lines: List<OrderLine>' }, { text: 'total(): Money', kind: 'method' }] },
		{ id: 'line', label: 'OrderLine', kind: 'entity', members: [{ text: 'sku: String' }, { text: 'quantity: int' }] },
		{ id: 'money', label: 'Money', kind: 'class', members: [{ text: 'cents: long' }] },
		{ id: 'policy', label: 'DiscountPolicy', kind: 'interface', members: [{ text: 'apply(order: Order): Money' }] },
		{ id: 'percent', label: 'PercentDiscount', kind: 'class', members: [{ text: 'percent: int' }, { text: '+ Money apply(Order order)' }] },
		{ id: 'svc', label: 'CheckoutService', kind: 'service', members: [{ text: 'checkout(order: Order, code: String): Receipt' }] },
		{ id: 'receipt', label: 'Receipt', kind: 'dto', members: [{ text: 'orderId: Long' }, { text: 'total: Money' }] },
		{ id: 'repo', label: 'OrderRepository', kind: 'repository', members: [{ text: 'save(order: Order): Order' }] },
		{ id: 'n', label: 'Discounts are applied before tax', kind: 'note' },
	],
	edges: [
		{ from: 'order', to: 'line', kind: 'has-many' },
		{ from: 'percent', to: 'policy', kind: 'implements' },
		{ from: 'svc', to: 'policy', kind: 'uses' },
		{ from: 'svc', to: 'repo', kind: 'uses' },
	],
})

function snapshot(name, text) {
	const dir = join(ROOT, 'test', 'skeleton-expected')
	const file = join(dir, `${name}.txt`)
	if (process.env.UPDATE) {
		mkdirSync(dir, { recursive: true })
		writeFileSync(file, text + '\n')
		return
	}
	assert.ok(existsSync(file), `no snapshot ${name}: run UPDATE=1 node --test test/skeleton-match.test.mjs and read test/skeleton-expected/${name}.txt`)
	assert.equal(text + '\n', readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
}

const rel = fixture => file => relative(join(FIXTURES, fixture), file).split('\\').join('/')
const byLabel = (diff, label) => diff.nodes.find(n => n.label === label)

/** What every language must agree on, whatever its notation. */
function commonChecks(diff) {
	assert.equal(diff.nodes.length, 8, 'the note is not a type')
	assert.equal(byLabel(diff, 'Order').check, 'matches', 'a private helper and wrapper types do not count')
	assert.equal(byLabel(diff, 'Money').check, 'matches')
	assert.equal(byLabel(diff, 'PercentDiscount').check, 'matches', 'extends DiscountPolicy satisfies the planned implements')
	const policy = byLabel(diff, 'DiscountPolicy')
	assert.equal(policy.check, 'differs')
	assert.match(policy.note, /interface/)
	const svc = byLabel(diff, 'CheckoutService')
	assert.equal(svc.check, 'differs')
	assert.match(svc.members[0].note, /1 parameter/)
	const receipt = byLabel(diff, 'Receipt')
	assert.equal(receipt.check, 'differs')
	assert.match(receipt.note, /ReceiptDto.*renamed/)
	const line = byLabel(diff, 'OrderLine')
	assert.equal(line.check, 'differs')
	assert.equal(line.members[1].check, 'differs')
	assert.match(line.members[1].note, /qty.*renamed/i)
	const repo = byLabel(diff, 'OrderRepository')
	assert.equal(repo.check, 'missing')
	assert.deepEqual(svc.relations.map(r => `${r.to}:${r.check}`), ['DiscountPolicy:matches', 'OrderRepository:missing'])
}

for (const [lang, fixture] of [['java', 'skeleton-java'], ['ts', 'skeleton-ts'], ['python', 'skeleton-py']]) {
	test(`plan vs code: ${lang}`, async () => {
		const g = await graphOf(fixture)
		const diff = match.matchPlan(PLAN, g)
		commonChecks(diff)
		snapshot(`checkout-${lang}`, match.diffText(diff, PLAN.title, rel(fixture)))
	})
}

/** The same skeleton as the C# analyzer reports it. */
function csharpSkeleton() {
	const N = 'Shop.Checkout'
	const type = (name, kind, extra = {}) => ({
		fqn: `${N}.${name}`, name, namespace: N, project: 'Shop', kind, file: `/src/${name}.cs`, line: 3, endLine: 20, interfaces: [], attributes: [],
		isAbstract: false, isStatic: false, typeParameters: [], fields: [], methods: [], constructorParameters: [], enumMembers: [], ...extra,
	})
	const prop = (name, t, refs = [], extra = {}) => ({ name, kind: 'property', type: t, refs, isCollection: false, nullable: false, visibility: 'public', isStatic: false, line: 5, ...extra })
	const param = (name, t, refs = []) => ({ name, type: t, refs })
	const method = (name, ret, refs, params = [], extra = {}) => ({ name, signature: `(${params.map(p => `${p.type} ${p.name}`).join(', ')}): ${ret}`, returnType: ret, returnRefs: refs, parameters: params, visibility: 'public', isStatic: false, line: 7, endLine: 9, ...extra })
	return {
		types: [
			type('Order', 'class', { fields: [prop('Id', 'long'), prop('Lines', 'IReadOnlyList<OrderLine>', [`${N}.OrderLine`], { isCollection: true })], methods: [method('Total', 'Money', [`${N}.Money`]), method('LineCount', 'int', [], [], { visibility: 'private' })] }),
			type('OrderLine', 'class', { fields: [prop('Sku', 'string'), prop('Qty', 'int')] }),
			type('Money', 'record', { fields: [prop('Cents', 'long')] }),
			type('DiscountPolicy', 'class', { isAbstract: true, methods: [method('Apply', 'Money', [`${N}.Money`], [param('order', 'Order', [`${N}.Order`])], { isAbstract: true })] }),
			type('PercentDiscount', 'class', { baseType: `${N}.DiscountPolicy`, fields: [prop('Percent', 'int')], methods: [method('Apply', 'Money', [`${N}.Money`], [param('order', 'Order', [`${N}.Order`])])] }),
			type('CheckoutService', 'class', { constructorParameters: [param('discounts', 'DiscountPolicy', [`${N}.DiscountPolicy`])], methods: [method('Checkout', 'Task<ReceiptDto>', [`${N}.ReceiptDto`], [param('order', 'Order', [`${N}.Order`])])] }),
			type('ReceiptDto', 'record', { fields: [prop('OrderId', 'long'), prop('Total', 'Money', [`${N}.Money`])] }),
		],
		entries: [],
	}
}

test('plan vs code: csharp (analyzer types)', async () => {
	const g = await graphOf([], { csharp: csharpSkeleton() })
	const diff = match.matchPlan(PLAN, g)
	commonChecks(diff)
	snapshot('checkout-csharp', match.diffText(diff, PLAN.title))
})

test('member notations: name(T a): R, R name(T a), name: T, T name, Python and TypeScript forms', () => {
	const p = match.parseMember
	assert.deepEqual(p('apply(order: Order): Money'), { name: 'apply', kind: 'method', params: ['Order'], type: 'Money' })
	assert.deepEqual(p('+ public Money apply(Order order, int pct)'), { name: 'apply', kind: 'method', params: ['Order', 'int'], type: 'Money' })
	assert.deepEqual(p('def apply(self, order: Order) -> Money'), { name: 'apply', kind: 'method', params: ['Order'], type: 'Money' })
	assert.deepEqual(p('lines: List<OrderLine>'), { name: 'lines', kind: 'field', type: 'List<OrderLine>' })
	assert.deepEqual(p('private final Map<String, Long> totals;'), { name: 'totals', kind: 'field', type: 'Map<String,Long>' })
	assert.deepEqual(p('note?: string'), { name: 'note', kind: 'field', type: 'string' })
	assert.deepEqual(p('id'), { name: 'id', kind: 'field', type: undefined })
	assert.deepEqual(p('find(id)'), { name: 'find', kind: 'method', params: [undefined], type: undefined })
})

test('types: wrappers, collections and aliases are tolerated, a different type or many-ness is not', () => {
	const same = match.sameType
	assert.ok(same('List<com.acme.OrderLine>', 'OrderLine[]'))
	assert.ok(same('IReadOnlyList<OrderLine>', 'Sequence[OrderLine]'))
	assert.ok(same('Optional<Money>', 'Money | null'))
	assert.ok(same('Promise<Receipt>', 'Receipt'))
	assert.ok(same('long', 'number'))
	assert.ok(same('String', 'str'))
	assert.ok(same(undefined, 'Money'), 'a side without a type never differs')
	assert.ok(!same('List<OrderLine>', 'OrderLine'))
	assert.ok(!same('Money', 'int'))
	assert.ok(!same('decimal', 'int'))
})

test('a node the code index has not loaded yet is not reported missing', () => {
	const diff = match.matchPlan(PLAN, { types: [], edges: [] }, { ready: false })
	assert.equal(diff.ready, false)
	assert.match(match.countsText(diff), /not checked yet/)
	const shown = match.decorate(PLAN, diff)
	assert.ok(shown.nodes.every(n => n.check === undefined), 'no colours while loading')
})

test('two types of one name: the one in a file the developer just changed is checked, and the answer says there were two', async () => {
	const g = await graphOf(['skeleton-java', 'skeleton-ts'])
	const recentTs = file => file.includes('skeleton-ts')
	const diff = match.matchPlan(PLAN, g, { recent: recentTs })
	const order = byLabel(diff, 'Order')
	assert.ok(order.file.includes('skeleton-ts'))
	assert.match(order.note, /2 types are called Order/)
})

test('decorate paints the shown copy only, and an agent cannot paint its own board', async () => {
	const g = await graphOf('skeleton-ts')
	const diff = match.matchPlan(PLAN, g)
	const shown = match.decorate(PLAN, diff, [{ owner: 'CheckoutService', name: 'checkout', text: 'The agent changed checkout(order: Order)' }])
	assert.equal(PLAN.nodes[0].check, undefined, 'the plan itself is untouched')
	assert.equal(shown.nodes.find(n => n.id === 'policy').check, 'differs')
	assert.equal(shown.nodes.find(n => n.id === 'svc').members[0].warn, 'The agent changed checkout(order: Order)')
	assert.match(shown.description, /^Plan vs code: 3 match · 1 missing · 4 differ/)
	assert.ok(shown.nodes.find(n => n.id === 'order').file, 'a matched node links to its type')
	const forged = spec.parseBoard({ kind: 'class', title: 'x', nodes: [{ id: 'a', label: 'A', check: 'matches', checkNote: 'fine', warn: 'w', members: [{ text: 'x: int', check: 'matches', warn: 'w' }] }] })
	assert.equal(forged.nodes[0].check, undefined)
	assert.equal(forged.nodes[0].warn, undefined)
	assert.equal(forged.nodes[0].members[0].check, undefined)
})

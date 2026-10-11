// Free-text search over entry points, flow/impact rendering as text, and the claude mcp command line.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, load } from './bundle.mjs'

let search, flowtext, command, impact
before(async () => {
	search = await load('src/mcp/search.ts')
	flowtext = await load('src/mcp/flowtext.ts')
	command = await load('src/mcp/command.ts')
	impact = await load('src/mcp/turnImpact.ts')
})
after(cleanup)

const entry = (http, controller, action, file = 'src/x.cs', line = 10) => ({ id: `${controller}.${action}`, http, controller, action, file, line, source: 'roslyn' })
const ENTRIES = [
	entry('GET /api/users', 'UsersController', 'List'),
	entry('GET /api/users/{id}', 'UsersController', 'Get'),
	entry('POST /api/users', 'UsersController', 'Create'),
	entry('DELETE /api/users/{id}', 'UsersController', 'Delete'),
	entry('DELETE /api/orders/{id}', 'OrdersController', 'Remove'),
	entry('POST /api/orders', 'OrdersController', 'Place'),
	entry('GET /api/orders/{id}/items', 'OrderItemsController', 'GetItems'),
]
const ids = hits => hits.map(h => h.entry.id)

test('mcp-search: "delete user" finds the DELETE endpoint of users first', () => {
	const hits = search.searchEntries(ENTRIES, 'delete user')
	assert.equal(hits[0].entry.id, 'UsersController.Delete')
	assert.ok(!ids(hits).includes('OrdersController.Remove'), 'orders do not match the noun user')
})

test('mcp-search: plural and singular, camelCase and verb synonyms all match', () => {
	assert.equal(search.searchEntries(ENTRIES, 'delete users')[0].entry.id, 'UsersController.Delete')
	assert.equal(search.searchEntries(ENTRIES, 'remove order')[0].entry.id, 'OrdersController.Remove', 'remove is a DELETE verb and a method name')
	assert.equal(search.searchEntries(ENTRIES, 'create user')[0].entry.id, 'UsersController.Create')
	assert.equal(search.searchEntries(ENTRIES, 'order items')[0].entry.id, 'OrderItemsController.GetItems')
	assert.equal(search.searchEntries(ENTRIES, 'place order')[0].entry.id, 'OrdersController.Place')
})

test('mcp-search: words about the kind of thing asked for are ignored', () => {
	assert.equal(search.searchEntries(ENTRIES, 'open the delete users flow')[0].entry.id, 'UsersController.Delete')
	assert.equal(search.searchEntries(ENTRIES, 'DELETE /api/orders/{id} endpoint')[0].entry.id, 'OrdersController.Remove')
})

test('mcp-search: a verb alone ranks by HTTP verb, nothing matches nonsense, empty lists everything capped', () => {
	assert.deepEqual(ids(search.searchEntries(ENTRIES, 'delete')).sort(), ['OrdersController.Remove', 'UsersController.Delete'])
	assert.deepEqual(search.searchEntries(ENTRIES, 'zebra'), [])
	assert.equal(search.searchEntries(ENTRIES, '').length, ENTRIES.length)
	assert.equal(search.searchEntries(ENTRIES, '', 3).length, 3)
	assert.equal(search.searchEntries(ENTRIES, 'user', 1).length, 1)
	assert.equal(search.searchEntries(ENTRIES, '', 1000).length, ENTRIES.length, 'the limit is capped at 50, not a crash')
})

const node = (label, file, startLine, children = [], extra = {}) => ({ key: label, symbolId: label, label, sub: '', kind: 'method', file, startLine, endLine: startLine + 5, code: null, children, ...extra })
const call = (n, callLine = 3, edgeKind = 'call', extra = {}) => ({ callLine, edgeKind, node: n, ...extra })
const rel = f => f.replace('C:/app/', '')

test('mcp-flowtext: an indented call chain with call lines, locations and tables', () => {
	const db = node('users', null, 0, [], { kind: 'db', sub: 'DELETE' })
	const repo = node('UserRepository.Delete', 'C:/app/Repo.cs', 20, [call(db, 24, 'db')])
	const svc = node('UserService.Remove', 'C:/app/Svc.cs', 30, [call(repo, 33), call(node('IAudit.Log', 'C:/app/Audit.cs', 5), 34, 'impl', { guess: true })])
	const root = node('UsersController.Delete', 'C:/app/Ctl.cs', 12, [call(svc, 15, 'mediator')], { sub: 'DELETE /users/{id}' })
	const t = flowtext.flowToText(root, { rel })
	assert.equal(t.text, [
		'UsersController.Delete  Ctl.cs:12-17',
		'  -> L15 UserService.Remove  Svc.cs:30-35 ~mediator',
		'    -> L33 UserRepository.Delete  Repo.cs:20-25',
		'      -> L24 [db] users (DELETE)',
		'    -> L34 IAudit.Log  Audit.cs:5-10 ~impl ~guess',
	].join('\n'))
	assert.deepEqual(t.tables, ['users'])
	assert.equal(t.nodes, 5)
})

test('mcp-flowtext: depth, repeated subtrees and the line cap keep the output small', () => {
	const leaf = node('Leaf', 'C:/app/L.cs', 1)
	const mid = node('Mid', 'C:/app/M.cs', 1, [call(leaf)])
	const root = node('Root', 'C:/app/R.cs', 1, [call(mid), call(mid, 9)])
	const shallow = flowtext.flowToText(root, { rel, depth: 1 }).text
	assert.match(shallow, /Mid  M\.cs:1-6  \(\+1 deeper\)/)
	assert.doesNotMatch(shallow, /Leaf/)
	assert.match(flowtext.flowToText(root, { rel }).text, /Mid.*\(expanded above\)/, 'the second Mid is not drawn again')
	const wide = node('Wide', 'C:/app/W.cs', 1, Array.from({ length: 500 }, (_, i) => call(node(`C${i}`, 'C:/app/C.cs', i))))
	const cut = flowtext.flowToText(wide, { rel, maxLines: 20 })
	assert.equal(cut.truncated, true)
	assert.ok(cut.text.split('\n').length <= 22)
	assert.match(cut.text, /output cut at 20 lines/)
})

test('mcp-flowtext: callers read upwards', () => {
	const entryNode = node('GET /orders', 'C:/app/O.cs', 4)
	const root = node('OrderService.Place', 'C:/app/S.cs', 9, [call(entryNode, 11)])
	assert.match(flowtext.flowToText(root, { rel }, 'callers').text, /<- L11 GET \/orders/)
})

test('mcp-command: the claude mcp add line puts the name first and quotes paths with spaces', () => {
	const withNode = command.mcpAddCommand('C:\\Program Files\\Axle\\out\\axle-mcp.js', { pathNode: 'C:\\nvm4w\\nodejs\\node.exe', execPath: 'C:\\Axle\\Axle.exe' })
	assert.deepEqual(withNode.args, ['mcp', 'add', 'axle', '--scope', 'user', '--', 'C:\\nvm4w\\nodejs\\node.exe', 'C:\\Program Files\\Axle\\out\\axle-mcp.js'])
	assert.equal(withNode.electron, false)
	assert.equal(command.commandLine(withNode.args, 'win32'), 'claude mcp add axle --scope user -- "C:\\nvm4w\\nodejs\\node.exe" "C:\\Program Files\\Axle\\out\\axle-mcp.js"')
	const bare = command.mcpAddCommand('/opt/axle/out/axle-mcp.js', { execPath: '/opt/axle/axle' })
	assert.deepEqual(bare.args, ['mcp', 'add', 'axle', '--scope', 'user', '-e', 'ELECTRON_RUN_AS_NODE=1', '--', '/opt/axle/axle', '/opt/axle/out/axle-mcp.js'])
	assert.ok(bare.args.indexOf('axle') < bare.args.indexOf('-e'), 'the variadic -e must not swallow the server name')
	assert.equal(command.shellQuote("it's here", 'linux'), "'it'\\''s here'")
})

test('mcp-command: PATH lookup finds node, honouring PATHEXT on Windows', () => {
	const there = new Set(['C:\\tools\\node.exe', '/usr/bin/node'])
	assert.equal(command.findOnPath('node', { PATH: 'C:\\x;C:\\tools', PATHEXT: '.COM;.EXE' }, 'win32', p => there.has(p)), 'C:\\tools\\node.exe')
	assert.equal(command.findOnPath('node', { PATH: '/bin:/usr/bin' }, 'linux', p => there.has(p)), '/usr/bin/node')
	assert.equal(command.findOnPath('node', { PATH: '/bin' }, 'linux', () => false), undefined)
})

test('mcp-command: the --mcp-config file declares the axle server with its workspace', () => {
	const c = command.mcpConfig('/ext/out/axle-mcp.js', { execPath: '/axle', electron: true, workspace: '/w' })
	assert.deepEqual(c, { mcpServers: { axle: { command: '/axle', args: ['/ext/out/axle-mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1', AXLE_WORKSPACE: '/w' } } } })
	assert.deepEqual(command.mcpConfig('/s.js', { execPath: '/usr/bin/node', electron: false }).mcpServers.axle.env, {})
})

test('mcp-impact: an impact line is matched to the entry it names', () => {
	const entries = ENTRIES.map(e => ({ ...e, source: 'roslyn' }))
	assert.equal(impact.entryForItem('DELETE Users.Delete', entries)?.id, 'UsersController.Delete')
	assert.equal(impact.entryForItem('Users.Delete', entries)?.id, 'UsersController.Delete', 'Roslyn lists Controller.Action without the verb')
	assert.equal(impact.entryForItem('DELETE UsersController.Delete', entries)?.id, 'UsersController.Delete')
	assert.equal(impact.entryForItem('Xusers.Delete', entries), undefined)
	assert.equal(impact.entryForItem('Nothing.Here', entries), undefined)
})

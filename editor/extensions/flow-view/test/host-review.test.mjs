// Regression tests for the flow-view host review: Undo and card diffs of pure deletions, the Home page (what it opens, its
// CSP and escaping, git churn in a subfolder), the bridge client and server (a broken answer, a byte limit), flow_text's
// ambiguous calls, plan links without a containerName, how `claude` is started without a shell, the canvas's ask message
// and the change list of open_diff.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import vm from 'node:vm'
import { structuredPatch } from 'diff'
import { cleanup, load, temp } from './bundle.mjs'

let cm, flowtext, plan, command, home, http, ask, changes
before(async () => {
	[cm, flowtext, plan, command, home, http, ask, changes] = await Promise.all([
		'src/mcp/changedMethods.ts', 'src/mcp/flowtext.ts', 'src/mcp/planHost.ts', 'src/mcp/command.ts', 'src/home.ts', 'src/mcp/http.ts', 'src/tour/ask.ts', 'src/mcp/changes.ts',
	].map(load))
})
after(() => cleanup())

const hunksOf = (from, to) => structuredPatch('a', 'b', from, to, '', '', { context: 0 }).hunks

/** What Undo does to the current text: every hunk's edit, bottom first so the line numbers above stay valid. */
function undoAll(now, hunks) {
	const lines = now.split('\n')
	for (const e of hunks.map(h => cm.undoEdit(h)).sort((a, b) => b.from - a.from)) {
		lines.splice(e.from, e.to - e.from, ...e.lines)
	}
	return lines.join('\n')
}

// ── #1 Undo of a pure deletion ──────────────────────────────────────────────

test('jsdiff (context 0) gives a pure deletion newStart = the line after the gap', () => {
	const [h] = hunksOf('a\nb\nc\nd\ne\n', 'a\nb\ne\n')
	assert.deepEqual([h.oldStart, h.oldLines, h.newStart, h.newLines], [3, 2, 3, 0])
})

test('Undo puts deleted lines back where they were: middle, top and end of the file', () => {
	const before = 'a\nb\nc\nd\ne\n'
	for (const now of ['a\nb\ne\n', 'c\nd\ne\n', 'a\nb\nc\n', 'a\nc\ne\n']) {
		assert.equal(undoAll(now, hunksOf(before, now)), before, `undo of ${JSON.stringify(now)}`)
	}
})

test('Undo of insertions, changes and deletions in one file gives the baseline back', () => {
	const before = ['class A {', '  a() {', '    one', '    two', '  }', '  b() {', '    three', '  }', '}', ''].join('\n')
	const now = ['class A {', '  a() {', '    ONE', '  }', '  b() {', '    three', '    four', '  }', '}', ''].join('\n')
	assert.equal(undoAll(now, hunksOf(before, now)), before)
})

// ── #2 Which method a pure deletion belongs to ──────────────────────────────

//               1            2          3          4         5       6             7           8         9       10
const BEFORE = ['class A {', '  a() {', '    one', '    two', '  }', '  // note', '  b() {', '    three', '  }', '}', ''].join('\n')

test('deleting the last statement of a method shows on that method, with the red lines after the line above the gap', () => {
	const now = BEFORE.replace('    two\n', '')
	const hunks = hunksOf(BEFORE, now)
	// Method a is now lines 2-4 (its closing brace moved up to line 4); the old code skipped the hunk (from 5 > end 4).
	const d = cm.spanDiff(hunks, 2, 4)
	assert.deepEqual(d, { added: [], removed: [{ after: 3, lines: ['    two'] }], plus: 0, minus: 1 })
	assert.equal(hunks.filter(h => cm.rangeTouches(cm.rangeOfHunk(h), 2, 4)).length, 1, 'Undo on the card finds the hunk')
	assert.equal(cm.spanDiff(hunks, 6, 8), undefined, 'method b below is not charged with it')
})

test('a line deleted just above a method is not charged to that method', () => {
	const now = BEFORE.replace('  // note\n', '')
	const hunks = hunksOf(BEFORE, now)
	// b is now lines 6-8; a is 2-5. The gap lies between 5 and 6: inside neither.
	assert.equal(cm.spanDiff(hunks, 6, 8), undefined)
	assert.equal(cm.spanDiff(hunks, 2, 5), undefined)
	assert.deepEqual(cm.methodsTouched([{ id: 'a', name: 'A.a', line: 2, startLine: 2, endLine: 5 }, { id: 'b', name: 'A.b', line: 6, startLine: 6, endLine: 8 }], cm.rangesFromHunks(hunks)).wholeFile, true)
})

test('an added line keeps its place on the card', () => {
	const now = BEFORE.replace('    three', '    three\n    four')
	assert.deepEqual(cm.spanDiff(hunksOf(BEFORE, now), 7, 10), { added: [9], removed: [], plus: 1, minus: 0 })
})

// ── #3 #4 #10 Home ──────────────────────────────────────────────────────────

test('Home: lines from the page are whole numbers inside the file (0-based), or none', () => {
	assert.equal(home.homeLine(3, 10), 3)
	assert.equal(home.homeLine(0, 10), 0)
	assert.equal(home.homeLine(99, 10), 9)
	assert.equal(home.homeLine(0, 0), 0)
	for (const bad of [-1, 1.5, NaN, Infinity, '3', null, undefined, {}]) {
		assert.equal(home.homeLine(bad, 10), undefined, String(bad))
	}
})

test('Home: paths are compared resolved, and without case on Windows', () => {
	assert.equal(home.pathKey('C:\\Work\\A.ts', 'win32'), home.pathKey('c:\\work\\x\\..\\a.ts', 'win32'))
	assert.notEqual(home.pathKey('/work/A.ts', 'linux'), home.pathKey('/work/a.ts', 'linux'))
})

test('Home: open accepts only the files the host listed, never another path on disk', () => {
	const offered = home.offeredFiles(
		[{ path: 'C:\\work\\app\\src\\orders.ts' }],
		[{ file: 'C:\\Users\\x\\.claude\\settings.json', line: 3 }, { file: 42 }, null, { message: 'no file' }],
		'win32',
	)
	assert.equal(offered.size, 2)
	assert.equal(home.canOpen(offered, 'C:\\work\\app\\src\\orders.ts', 'win32'), true)
	assert.equal(home.canOpen(offered, 'c:/WORK/app/src/Orders.ts', 'win32'), true, 'same file, other spelling')
	assert.equal(home.canOpen(offered, 'C:\\Users\\x\\.claude\\settings.json', 'win32'), true, 'a harness issue in ~/.claude')
	for (const bad of ['C:/Users/x/.ssh/id_rsa', 'C:\\work\\app\\src\\orders.ts\\..\\..\\..\\secret.txt', 'C:\\work\\app\\src', '', undefined, 7, ['C:\\work\\app\\src\\orders.ts']]) {
		assert.equal(home.canOpen(offered, bad, 'win32'), false, String(bad))
	}
	assert.equal(home.offeredFiles([], 'not a list', 'linux').size, 0)
})

/** Runs the Home page's script against a tiny DOM and returns what it wrote, after posting `data` to it. */
function renderHome(data) {
	const html = home.homeHtml('TESTNONCE')
	const script = html.match(/<script nonce="TESTNONCE">([\s\S]*?)<\/script>/)[1]
	const elements = new Map()
	const el = () => ({ innerHTML: '', textContent: '', value: '', disabled: false, style: {}, dataset: {}, addEventListener() { }, setAttribute() { }, focus() { } })
	let onMessage
	const sandbox = {
		acquireVsCodeApi: () => ({ postMessage() { } }),
		navigator: { platform: 'Win32' },
		document: {
			getElementById: id => elements.get(id) ?? elements.set(id, el()).get(id),
			querySelectorAll: () => [],
		},
		window: { addEventListener: (type, fn) => { if (type === 'message') onMessage = fn } },
		Date, Math, Number, String, Set,
	}
	vm.runInNewContext(script, sandbox)
	onMessage({ data })
	return elements
}

test('Home: the page runs by a nonce only, no inline script', () => {
	const html = home.homeHtml('TESTNONCE')
	const csp = html.match(/content="([^"]*)"/)[1]
	assert.match(csp, /script-src 'nonce-TESTNONCE'/)
	assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/)
	const scripts = html.match(/<script\b[^>]*>/g)
	assert.ok(scripts.length >= 1)
	assert.ok(scripts.every(s => s === '<script nonce="TESTNONCE">'), scripts.join(' '))
	assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handler attributes')
})

test('Home: nothing the host sends becomes markup, numbers from flowHarness included', () => {
	const evil = '"><img src=x onerror=alert(1)>\''
	const elements = renderHome({
		type: 'data', repo: evil, branch: evil, hour: 10,
		files: [{ path: evil, name: evil, dir: evil, at: evil }],
		flows: [], endpoints: [{ id: evil, source: evil, label: evil, http: evil, route: evil, detail: evil }], total: evil,
		health: {
			score: evil, counts: { error: evil, warning: evil }, startupTokens: evil,
			totals: { instructions: evil, skills: evil, hooks: evil, mcp: evil },
			bySource: { project: { instructions: evil, skills: 2, hooks: 0, mcp: evil }, user: {} },
			issues: [{ severity: evil, message: evil, label: evil, file: evil, line: evil }],
			gaps: [{ label: evil, message: evil }],
		},
	})
	const written = [...elements.values()].map(e => e.innerHTML).join('\n')
	assert.ok(written.length > 0)
	assert.doesNotMatch(written, /<img/i)
	assert.doesNotMatch(written, /data-line="[^"]+"/, 'a line that is not a number is no line')
	assert.match(written, /&#39;/, "' is escaped")
	assert.match(elements.get('health').innerHTML, /<span class="score bad">0<\/span>/)
})

test('Home: issue lines that are numbers go back to the host', () => {
	const elements = renderHome({
		type: 'data', repo: 'r', hour: 10, files: [], flows: [], endpoints: [], total: 0,
		health: { score: 90, counts: { error: 0, warning: 1 }, startupTokens: 1200, totals: { instructions: 1, skills: 0, hooks: 0, mcp: 0 }, issues: [{ severity: 'warning', message: 'm', file: '/w/CLAUDE.md', line: 4 }] },
	})
	assert.match(elements.get('health').innerHTML, /data-line="4"/)
	assert.match(elements.get('health').innerHTML, /score good">90</)
})

test('Home: churn of a workspace that is a subfolder of the repository is keyed by the real file', async () => {
	const repo = realpathSync.native(temp('insilode-churn-'))
	mkdirSync(join(repo, 'services', 'api'), { recursive: true })
	writeFileSync(join(repo, 'services', 'api', 'orders.ts'), 'x\n')
	writeFileSync(join(repo, 'top.ts'), 'y\n')
	const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, stdio: 'ignore' })
	git('init', '-q')
	git('add', '.')
	git('commit', '-q', '-m', 'one')
	writeFileSync(join(repo, 'services', 'api', 'orders.ts'), 'x2\n')
	git('commit', '-q', '-am', 'two')
	const api = join(repo, 'services', 'api')
	const churn = await home.gitChurn(api)
	assert.equal(churn.get(home.pathKey(join(api, 'orders.ts'))), 2)
	assert.equal([...churn.keys()].some(k => k.includes('top.ts')), false, 'files outside the workspace folder are left out')
	assert.equal((await home.gitChurn(temp('insilode-norepo-'))).size, 0)
})

// ── #5 #13 the bridge ───────────────────────────────────────────────────────

// Before the fix the call never settled (or the response's 'error' was uncaught): the timeout turns a hang into a failure.
test('callBridge: a window that goes away in the middle of its answer fails the call and does not crash the MCP server', { timeout: 10_000 }, async () => {
	const server = createServer(socket => {
		socket.once('data', () => {
			socket.write('HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 100\r\n\r\n{"content":')
			setTimeout(() => socket.destroy(), 20)
		})
	})
	await new Promise(r => server.listen(0, '127.0.0.1', r))
	try {
		const call = http.callBridge({ port: server.address().port, token: 't' }, 'get_context', {}, 5000)
		await assert.rejects(call, e => !(e instanceof http.Unreachable) && /closed the connection/.test(e.message))
	} finally {
		server.close()
	}
})

test('bridge server: the body limit counts bytes, and a multibyte body under it arrives whole', async () => {
	const calls = []
	const server = await http.startBridgeServer(async (tool, args) => { calls.push(args); return { content: [{ type: 'text', text: 'ok' }] } }, { token: 'secret-token-1234', maxBody: 1000 })
	const nodeHttp = await import('node:http')
	const send = body => new Promise(resolve => {
		const req = nodeHttp.request({ host: '127.0.0.1', port: server.port, path: '/call', method: 'POST', agent: false, headers: { 'x-insilode-token': 'secret-token-1234', 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
		req.on('error', () => resolve('reset'))
		req.end(body)
	})
	try {
		// 600 characters, 1800 bytes: under the limit by characters, over it by bytes.
		const big = JSON.stringify({ tool: 'get_context', args: { q: '€'.repeat(600) } })
		assert.ok(big.length < 1000 && Buffer.byteLength(big) > 1000)
		assert.ok([413, 'reset'].includes(await send(big)))
		assert.equal(calls.length, 0, 'the handler never saw it')
		assert.equal(await send(JSON.stringify({ tool: 'get_context', args: { q: '€ü' } })), 200)
		assert.deepEqual(calls, [{ q: '€ü' }])
	} finally {
		await server.close()
	}
})

// ── #6 flow_text and ambiguous calls ────────────────────────────────────────

const node = (label, file, startLine, children = [], extra = {}) => ({ key: label, symbolId: file ? `${file}#${label}` : null, label, sub: '', kind: 'method', file, startLine, endLine: startLine + 2, code: null, children, ...extra })
const edge = (n, callLine = 1, edgeKind = 'call') => ({ callLine, edgeKind, node: n })

test('flow_text lists the candidates of every ambiguous call, not only the first', () => {
	const amb = (label, impls) => node(label, null, 0, impls.map(i => edge(i, 3, 'impl')), { kind: 'ambiguous', sub: `${impls.length} implementations` })
	const root = node('OrderService.Place', '/w/S.ts', 1, [
		edge(amb('IPayments.Charge', [node('Stripe.Charge', '/w/Stripe.ts', 5), node('Paypal.Charge', '/w/Paypal.ts', 5)]), 2),
		edge(amb('INotifier.Send', [node('Mail.Send', '/w/Mail.ts', 5), node('Sms.Send', '/w/Sms.ts', 5)]), 3),
	])
	const text = flowtext.flowToText(root, { rel: f => f }).text
	for (const name of ['Stripe.Charge', 'Paypal.Charge', 'Mail.Send', 'Sms.Send']) {
		assert.match(text, new RegExp(name.replace('.', '\\.')), name)
	}
	assert.doesNotMatch(text, /expanded above/)
})

test('flow_text still folds a repeated method', () => {
	const shared = () => node('Repo.Save', '/w/Repo.ts', 4, [edge(node('Db.Write', '/w/Db.ts', 1))])
	const text = flowtext.flowToText(node('A.run', '/w/A.ts', 1, [edge(shared(), 2), edge(shared(), 3)]), { rel: f => f }).text
	assert.equal(text.match(/expanded above/g)?.length, 1)
})

// ── #7 plan links ───────────────────────────────────────────────────────────

test('plan links: a symbol with no containerName (Python, Go) matches by full name only and never throws', () => {
	assert.equal(plan.symbolNamed({ name: 'place' }, 'Orders', 'place'), false)
	assert.equal(plan.symbolNamed({ name: 'place', containerName: undefined }, 'Orders', 'place'), false)
	assert.equal(plan.symbolNamed({ name: 'place', containerName: '' }, 'Orders', 'place'), false)
	assert.equal(plan.symbolNamed({ name: 'Orders.place', containerName: undefined }, 'Orders', 'place'), true)
	assert.equal(plan.symbolNamed({ name: 'place', containerName: 'Orders' }, 'Orders', 'place'), true)
	assert.equal(plan.symbolNamed({ name: 'place', containerName: 'app.Orders' }, 'Orders', 'place'), true)
	assert.equal(plan.symbolNamed({ name: 'place', containerName: 'MyOrders' }, 'Orders', 'place'), false)
})

// ── #8 starting claude without a shell ──────────────────────────────────────

test('claude runs from an argument array: as is off Windows, the .exe directly, the .cmd shim through cmd.exe quoted', () => {
	const args = ['mcp', 'add', 'insilode', '--', 'C:\\Program Files\\node.exe', 'C:\\a b\\x.js']
	assert.deepEqual(command.claudeLaunch(args, 'linux'), { file: 'claude', args })
	assert.deepEqual(command.claudeLaunch(args, 'win32', () => 'C:\\bin\\claude.exe'), { file: 'C:\\bin\\claude.exe', args })
	assert.equal(command.claudeLaunch(args, 'win32', () => undefined), undefined)
	const shim = command.claudeLaunch(['mcp', 'add', 'a & del x', '--', 'C:\\'], 'win32', () => 'C:\\npm\\claude.cmd')
	assert.equal(shim.file, 'cmd.exe')
	assert.equal(shim.windowsVerbatimArguments, true)
	// `&` stays inside its quotes; a trailing backslash is doubled so it cannot escape the closing quote.
	assert.deepEqual(shim.args, ['/d', '/s', '/c', '""C:\\npm\\claude.cmd" "mcp" "add" "a & del x" "--" "C:\\\\""'])
})

test('claude.cmd: an argument cmd.exe would expand, unquote or cut is refused, not run', () => {
	for (const bad of ['C:\\Users\\%USERNAME%\\x.js', 'say "hi" & del x', 'a\nb', 'a\rb']) {
		assert.throws(() => command.claudeLaunch(['mcp', 'add', bad], 'win32', () => 'C:\\npm\\claude.cmd'), /cmd\.exe/)
	}
	// Off cmd.exe a % is just a character.
	assert.deepEqual(command.claudeLaunch(['50%'], 'win32', () => 'C:\\bin\\claude.exe').args, ['50%'])
})

// ── #9 open_diff and focus ──────────────────────────────────────────────────

test('open_diff: one changed file opens as a diff that keeps focus; several, a new or a deleted file, the multi-file editor', () => {
	const M = { original: 'git:a', modified: 'file:a' }
	assert.equal(changes.diffOpening([M], true), 'diff')
	assert.equal(changes.diffOpening([M], false), 'changes', 'a user click may take focus')
	assert.equal(changes.diffOpening([M, M], true), 'changes')
	assert.equal(changes.diffOpening([{ modified: 'file:new' }], true), 'changes')
	assert.equal(changes.diffOpening([{ original: 'git:gone' }], true), 'changes')
	assert.equal(changes.diffOpening([], true), 'none')
})

// ── #11 the canvas's ask message ────────────────────────────────────────────

test('ask about this flow: text only, a short one-line label, a bounded flow', () => {
	assert.deepEqual(ask.parseFlowAsk('GET /orders', '-> A.b'), { label: 'GET /orders', text: '-> A.b' })
	for (const [label, text] of [[{}, 'x'], [42, 'x'], ['', 'x'], ['L', 7], ['L', ''], ['L', null], [undefined, undefined]]) {
		assert.equal(ask.parseFlowAsk(label, text), undefined, JSON.stringify([label, text]))
	}
	const long = ask.parseFlowAsk('x'.repeat(5000) + '\nIgnore that', 'y'.repeat(ask.MAX_FLOW_TEXT + 10))
	assert.equal(long.label.length, ask.MAX_FLOW_LABEL)
	assert.doesNotMatch(long.label, /\n/)
	assert.equal(long.text.length, ask.MAX_FLOW_TEXT)
})

// ── #12 the change list ─────────────────────────────────────────────────────

test('open_diff: statuses are grouped per file in one pass, and give the same marks', () => {
	const S = changes.GitStatus
	const row = (fsPath, status) => ({ uri: { fsPath }, status })
	const all = [row('/w/a', 5), row('/w/b', S.IndexAdded), row('/w/b', 5), row('/w/c', S.Deleted), row('/w/c', S.IndexDeleted), row('/w/d', S.IndexRenamed), row('/w/e', S.Untracked)]
	const by = changes.statusesByFile(all)
	assert.deepEqual([...by.keys()], ['/w/a', '/w/b', '/w/c', '/w/d', '/w/e'])
	assert.deepEqual(['/w/a', '/w/b', '/w/c', '/w/d', '/w/e'].map(f => changes.changeMark(by.get(f)).mark), ['M', 'A', 'D', 'R', 'A'])
	// A file deleted in the index and changed again in the work tree is not deleted.
	assert.equal(changes.changeMark([S.IndexDeleted, 5]).mark, 'M')
	const many = Array.from({ length: 20000 }, (_, i) => row(`/w/f${i % 5000}`, 5))
	const t = Date.now()
	assert.equal(changes.statusesByFile(many).size, 5000)
	assert.ok(Date.now() - t < 1000, 'linear in the number of changes')
})

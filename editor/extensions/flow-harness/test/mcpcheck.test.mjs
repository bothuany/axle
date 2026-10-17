// The MCP status check (src/mcpcheck.ts) against fake servers it starts itself: a stdio server written to a temp
// folder and run with this node, and a loopback HTTP server answering in JSON and in SSE. Nothing leaves the machine.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let m
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-mcpcheck-'))
	const outfile = join(tmp, 'mcpcheck.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'mcpcheck.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	m = await import(pathToFileURL(outfile).href)
	// Two pages of tools; it reads its greeting from the environment, so env passing is checked too.
	writeFileSync(join(tmp, 'server.mjs'), `
import { createInterface } from 'node:readline'
const out = o => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\\n')
console.error('starting')
process.stdout.write('a stray log line\\n')
createInterface({ input: process.stdin }).on('line', l => {
	const r = JSON.parse(l)
	if (r.method === 'initialize') out({ id: r.id, result: { protocolVersion: r.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: process.env.GREETING, version: '1.2.3' } } })
	if (r.method === 'tools/list' && !r.params.cursor) out({ id: r.id, result: { tools: [{ name: 'a', description: 'first', inputSchema: { type: 'object' } }], nextCursor: 'p2' } })
	if (r.method === 'tools/list' && r.params.cursor === 'p2') out({ id: r.id, result: { tools: [{ name: 'b', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } }] } })
})
`)
	writeFileSync(join(tmp, 'silent.mjs'), 'setInterval(() => {}, 1000)\n')
	writeFileSync(join(tmp, 'crash.mjs'), 'console.error("boom: missing API_KEY"); process.exit(3)\n')
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('stdio: initialize, tools/list over two pages, env, server info', async () => {
	const r = await m.checkStdio({ command: process.execPath, args: [join(tmp, 'server.mjs')], env: { GREETING: '${WHO:-fallback}' } }, { timeoutMs: 15000, env: { ...process.env, WHO: 'fake-server' } })
	assert.equal(r.ok, true, r.status)
	assert.equal(r.how, 'handshake')
	assert.deepEqual(r.tools.map(t => t.name), ['a', 'b'])
	assert.equal(r.serverName, 'fake-server')
	assert.ok(r.schemaTokens > 10)
	assert.match(r.status, /^2 tools, ~\d+ tokens/)
})

test('stdio: a server that never answers is killed at the timeout; one that exits says so', async () => {
	const t0 = Date.now()
	const r = await m.checkStdio({ command: process.execPath, args: [join(tmp, 'silent.mjs')], env: {} }, { timeoutMs: 800 })
	assert.equal(r.ok, false)
	assert.match(r.status, /No answer to initialize/)
	assert.ok(Date.now() - t0 < 5000)
	const c = await m.checkStdio({ command: process.execPath, args: [join(tmp, 'crash.mjs')], env: {} }, { timeoutMs: 8000 })
	assert.match(c.status, /Exited with code 3/)
	assert.match(c.stderr, /boom/)
	const n = await m.checkStdio({ command: 'surely-not-a-program-axle', args: [], env: {} }, { timeoutMs: 8000 })
	assert.match(n.status, /not found on PATH|Could not start/)
})

test('Windows: a .cmd shim is reported, never run through a shell', async () => {
	const files = new Set(['C:\\node\\npx.cmd', 'C:\\node\\node.exe'])
	assert.equal(m.windowsScript('npx', { PATH: 'C:\\node' }, f => files.has(f)), 'C:\\node\\npx.cmd')
	assert.equal(m.windowsScript('node', { PATH: 'C:\\node' }, f => files.has(f)), undefined)
	assert.equal(m.windowsScript('C:\\x\\run.bat', {}, () => false), 'C:\\x\\run.bat')
	const r = await m.checkStdio({ command: 'npx', args: ['-y', 'x'], env: {} }, { platform: 'win32', env: { PATH: 'C:\\node' }, isFile: f => files.has(f) })
	assert.equal(r.ok, false)
	assert.match(r.status, /cmd/)
})

test('expanding ${VAR} and ${VAR:-default} as Claude Code does', () => {
	assert.equal(m.expandVars('${A}/${B:-dflt}/${C}', { A: 'a' }), 'a/dflt/${C}')
})

test('HTTP: JSON and SSE answers, the session id, paging, and a 401 as a sign-in', async () => {
	const seen = []
	const srv = createServer((req, res) => {
		let body = ''
		req.on('data', d => body += d)
		req.on('end', () => {
			if (req.url === '/locked') {
				res.writeHead(401).end()
				return
			}
			if (req.method === 'DELETE') {
				res.writeHead(204).end()
				return
			}
			const r = JSON.parse(body)
			seen.push({ method: r.method, session: req.headers['mcp-session-id'], auth: req.headers.authorization })
			if (r.method === 'initialize') {
				res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'S1' }).end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'web' } } }))
			} else if (r.method === 'notifications/initialized') {
				res.writeHead(202).end()
			} else {
				// SSE that stays open after the reply, as some servers do.
				res.writeHead(200, { 'content-type': 'text/event-stream' })
				res.write(': ping\n\n')
				const page = r.params.cursor ? { tools: [{ name: 'y' }] } : { tools: [{ name: 'x' }], nextCursor: 'c' }
				res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: r.id, result: page })}\n\n`)
			}
		})
	})
	await new Promise(r => srv.listen(0, '127.0.0.1', r))
	const base = `http://127.0.0.1:${srv.address().port}`
	try {
		const r = await m.checkHttp({ url: `${base}/mcp`, headers: { Authorization: 'Bearer ${TOK}' } }, { timeoutMs: 8000, env: { TOK: 't0k' } })
		assert.equal(r.ok, true, r.status)
		assert.deepEqual(r.tools.map(t => t.name), ['x', 'y'])
		assert.equal(seen[1].session, 'S1', 'the session id goes back on later requests')
		assert.equal(seen[0].auth, 'Bearer t0k')
		const locked = await m.checkHttp({ url: `${base}/locked`, headers: {} }, { timeoutMs: 5000 })
		assert.equal(locked.needsAuth, true)
		assert.match(locked.status, /sign-in/)
	} finally {
		srv.closeAllConnections()
		srv.close()
	}
})

test('claude mcp get: only the Status and Issue lines, never the environment it prints', () => {
	const out = 'probel:\n  Scope: Local config\n  Status: ✘ Failed to connect\n  Issue: CONNECTION_CLOSED: Connection closed\n  Type: stdio\n  Environment:\n    A=secret\n'
	assert.deepEqual(m.parseClaudeGet(out), { ok: false, status: 'Failed to connect: CONNECTION_CLOSED: Connection closed' })
	assert.deepEqual(m.parseClaudeGet('x:\n  Status: ✔ Connected\n'), { ok: true, status: 'Connected' })
	assert.equal(m.parseClaudeGet('nothing'), undefined)
})

test('runCli: an argument array, output and exit code', async () => {
	const r = await m.runCli(process.execPath, ['-e', 'console.log(process.argv[1]); process.exit(2)', 'a "quoted" & arg'], { cwd: tmp, timeoutMs: 10000 })
	assert.equal(r.code, 2)
	assert.equal(r.out, 'a "quoted" & arg')
})

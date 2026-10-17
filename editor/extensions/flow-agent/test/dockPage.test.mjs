// The Agents dock is one page built from strings in src/dock.ts; a quote lost in that string breaks the whole dock
// without a word. This builds the page and checks that its script parses and draws a row.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let html
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-dock-'))
	// html() needs nothing from vscode; any access returns a harmless stub.
	const stub = join(tmp, 'vscode.cjs')
	writeFileSync(stub, 'const s = new Proxy(function () {}, { get: () => s, apply: () => s }); module.exports = s;')
	const outfile = join(tmp, 'dock.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'dock.ts')], bundle: true, platform: 'node', format: 'esm', outfile, alias: { vscode: stub }, logLevel: 'silent' })
	const { AgentsDock } = await import(pathToFileURL(outfile).href)
	html = AgentsDock.prototype.html.call({})
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('the dock page script parses and draws an agent row with its avatar', () => {
	const script = /<script>([\s\S]*)<\/script>/.exec(html)[1]
	assert.doesNotThrow(() => new vm.Script(script), 'the dock script is valid JavaScript')
	const list = { innerHTML: '', querySelectorAll: () => [] }
	const document = { getElementById: () => list, querySelectorAll: () => [] }
	let onMessage
	const window = { addEventListener: (_type, f) => { onMessage = f } }
	const context = { window, document, acquireVsCodeApi: () => ({ postMessage() { } }), setInterval() { }, Math, Object, isFinite, Date, String, Number, Map }
	window.window = window
	vm.runInNewContext(script, context)
	const row = { id: 'a1', cli: 'claude', name: 'Claude 2', state: 'blocked', attention: 'approval', since: Date.now(), todos: [], unread: false, done: 0 }
	onMessage({ data: { type: 'data', list: [row], now: Date.now(), avatar: 'pixel' } })
	assert.match(list.innerHTML, /class="agent blocked approval"/)
	assert.match(list.innerHTML, /<span class="av" data-k="[^"]+"><svg class="ax"/)
	assert.match(list.innerHTML, /Claude 2/)
})

// Codex's observe-only hooks: the profile Axle writes and the command it runs (src/codexHooks.ts).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let c
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-codex-'))
	const outfile = join(tmp, 'codexHooks.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'codexHooks.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	c = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('codex home: CODEX_HOME wins, else ~/.codex; the profile sits in it', () => {
	assert.equal(c.codexHome({ CODEX_HOME: '/x/codex' }), '/x/codex')
	assert.equal(c.codexHome({}), join(homedir(), '.codex'))
	assert.equal(c.codexProfileFile({ CODEX_HOME: join('/x', 'codex') }), join('/x', 'codex', 'axle.config.toml'))
})

test('windows command: PowerShell call with literal strings', () => {
	assert.equal(
		c.codexHookCommand('win32', 'C:\\Users\\A B\\Axle\\Axle.exe', 'C:\\data\\codex-hook.js', true),
		"$env:ELECTRON_RUN_AS_NODE=1; & 'C:\\Users\\A B\\Axle\\Axle.exe' 'C:\\data\\codex-hook.js'")
	assert.equal(c.codexHookCommand('win32', 'C:\\node.exe', 'C:\\h.js', false), "& 'C:\\node.exe' 'C:\\h.js'")
	assert.equal(c.codexHookCommand('win32', "C:\\O'Brien\\Axle.exe", 'C:\\h.js', false), "& 'C:\\O''Brien\\Axle.exe' 'C:\\h.js'")
})

test('posix command: sh with single quotes', () => {
	assert.equal(c.codexHookCommand('darwin', '/Applications/Axle.app/Contents/MacOS/Axle', '/home/a/h.js', true),
		"ELECTRON_RUN_AS_NODE=1 '/Applications/Axle.app/Contents/MacOS/Axle' '/home/a/h.js'")
	assert.equal(c.codexHookCommand('linux', "/opt/it's/node", '/h.js', false), "'/opt/it'\\''s/node' '/h.js'")
})

test('toml strings escape backslashes, quotes and control characters', () => {
	assert.equal(c.tomlString('C:\\a "b"'), '"C:\\\\a \\"b\\""')
	assert.equal(c.tomlString('a\nb\tc'), '"a\\u000ab\\u0009c"')
	assert.equal(c.tomlString("it's"), `"it's"`)
})

test('the profile has every event once, the edit matcher on PreToolUse only, and the same command everywhere', () => {
	const cmd = "$env:ELECTRON_RUN_AS_NODE=1; & 'C:\\Axle\\Axle.exe' 'C:\\g\\codex-hook.js'"
	const toml = c.codexProfile(cmd)
	for (const [event] of c.CODEX_EVENTS) {
		assert.equal(toml.split('\n').filter(l => l === `[[hooks.${event}]]`).length, 1, event)
		assert.equal(toml.split('\n').filter(l => l === `[[hooks.${event}.hooks]]`).length, 1, event)
	}
	assert.deepEqual(toml.split('\n').filter(l => l.startsWith('matcher')), ['matcher = "^apply_patch$"'])
	const commands = toml.split('\n').filter(l => l.startsWith('command = '))
	assert.equal(commands.length, c.CODEX_EVENTS.length)
	assert.ok(commands.every(l => l === `command = ${c.tomlString(cmd)}`))
	assert.ok(toml.endsWith('\n'))
})

test('the profile is deterministic, so trust given once keeps holding', () => {
	assert.equal(c.codexProfile('a'), c.codexProfile('a'))
	assert.notEqual(c.codexProfile('a'), c.codexProfile('b'))
})

test('the hook script names no workspace: it is the same file for every window', () => {
	assert.ok(c.CODEX_HOOK_SCRIPT.includes('process.env.FLOW_HOOK_DIR'))
	assert.ok(!/[A-Z]:\\|\/home\/|\/Users\//.test(c.CODEX_HOOK_SCRIPT))
})

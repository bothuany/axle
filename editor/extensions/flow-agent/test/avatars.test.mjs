// The agent avatars the dock and the overlay draw (src/avatars.ts): every theme and state renders, and nothing from
// outside the fixed lists reaches the SVG.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let m
let avatar
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-avatars-'))
	const outfile = join(tmp, 'avatars.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'avatars.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	m = await import(pathToFileURL(outfile).href)
	// The script is meant for a page: run it against a bare window, as the dock's webview and the overlay do.
	const window = {}
	vm.runInNewContext(m.AVATAR_SCRIPT, { window, Math, Object, isFinite })
	avatar = window.axleAvatar
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const STATES = ['working', 'approval', 'question', 'error', 'done', 'idle']
const CLIS = ['claude', 'codex', 'custom']

test('every theme, agent and state draws a well-formed SVG of the asked size', () => {
	for (const kind of ['gyro', 'pixel']) {
		for (const cli of CLIS) {
			for (const state of STATES) {
				for (const context of [undefined, 0, 42, 100]) {
					const svg = avatar(kind, cli, state, context, 24)
					assert.match(svg, /^<svg class="ax" width="24" height="24" viewBox="[^"]+"( shape-rendering="crispEdges")? aria-hidden="true">.*<\/svg>$/s, `${kind}/${cli}/${state}/${context}`)
					assert.doesNotMatch(svg, /undefined|NaN|Infinity/, `${kind}/${cli}/${state}/${context}`)
				}
			}
		}
	}
})

test('anything outside the lists falls back, so no outside text reaches the markup', () => {
	const odd = avatar('<img src=x>', '"><script>', 'onload=alert(1)', 'lots', 1e9)
	assert.equal(odd, avatar('gyro', 'custom', 'idle', undefined, 96))
	assert.doesNotMatch(odd, /script|img|onload|alert/)
	assert.match(avatar('gyro', 'claude', 'working', -20, 2), /width="12"/)
})

test('the agent shows in its colour in every gyro state; working is drawn all in it', () => {
	const colour = { claude: '#ff9d7d', codex: '#7fe0d6', custom: '#c6a8ff' }
	for (const cli of CLIS) {
		for (const state of STATES) {
			assert.ok(avatar('gyro', cli, state, 50, 24).includes(colour[cli]), `${cli}/${state}`)
		}
	}
	assert.ok(!avatar('gyro', 'claude', 'approval', 50, 24).includes('ax-tm'), 'a waiting agent does not tumble')
	assert.ok(avatar('gyro', 'claude', 'working', 50, 24).includes('ax-tm'))
})

test('the page script holds no template literal, so it can be put inside one', () => {
	assert.ok(!m.AVATAR_SCRIPT.includes('`') && !m.AVATAR_SCRIPT.includes('${'))
	assert.ok(!m.AVATAR_CSS.includes('`') && !m.AVATAR_CSS.includes('${'))
})

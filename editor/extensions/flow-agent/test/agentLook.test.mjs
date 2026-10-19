// How an agent looks on the canvas (src/agentLook.ts): the name and colour of the ghost cursor of its tour.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let m
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-look-'))
	const outfile = join(tmp, 'agentLook.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'agentLook.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	m = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('each CLI has its avatar colour, and the name of the row is the label', () => {
	assert.deepEqual(m.agentLook({ name: 'Claude 2', cli: 'claude' }), { label: 'Claude 2', color: '#ff9d7d' })
	assert.deepEqual(m.agentLook({ name: 'Codex', cli: 'codex' }), { label: 'Codex', color: '#7fe0d6' })
	assert.deepEqual(m.agentLook({ name: 'Aider', cli: 'custom' }), { label: 'Aider', color: '#c6a8ff' })
})

test('a name is one short line, and an empty one is replaced', () => {
	assert.equal(m.agentLook({ name: `a\nb${String.fromCharCode(7)}${'x'.repeat(100)}`, cli: 'claude' }).label.length, 40)
	assert.doesNotMatch(m.agentLook({ name: 'a\nb', cli: 'claude' }).label, /\n/)
	assert.equal(m.agentLook({ name: '  ', cli: 'codex' }).label, 'Codex')
	assert.match(m.agentLook({ name: 'x', cli: 'claude' }).color, /^#[0-9a-f]{6}$/)
})

// What an agent starts with (src/env.ts): the folder its terminal opens in.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let e
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-env-'))
	const outfile = join(tmp, 'env.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'env.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	e = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('a Windows drive letter is upper case, as Claude Code files the folder from a terminal', () => {
	assert.equal(e.agentCwd(String.raw`c:\dev\app`, 'win32'), String.raw`C:\dev\app`)
	assert.equal(e.agentCwd(String.raw`C:\dev\app`, 'win32'), String.raw`C:\dev\app`)
	assert.equal(e.agentCwd(String.raw`\server\share\app`, 'win32'), String.raw`\server\share\app`, 'a UNC path has no drive')
	assert.equal(e.agentCwd('/home/me/app', 'linux'), '/home/me/app')
	assert.equal(e.agentCwd('c:/x', 'linux'), 'c:/x', 'only Windows')
	assert.equal(e.agentCwd(undefined, 'win32'), undefined)
})

// What a project has not set up in its harness (src/gaps.ts): an empty project must not score like a complete one.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let g
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-gaps-'))
	const outfile = join(tmp, 'gaps.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'gaps.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	g = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const keys = items => g.projectGaps(items).map(x => x.key)

test('an empty project misses instructions, hooks and permission rules, and only instructions cost points', () => {
	const gaps = g.projectGaps([])
	assert.deepEqual(gaps.map(x => x.key), ['instructions', 'hooks', 'permissions'])
	assert.equal(gaps.reduce((a, x) => a + x.cost, 0), 10)
})

test("the user's own harness does not fill a project gap", () => {
	assert.deepEqual(keys([{ kind: 'instructions', scope: 'user' }, { kind: 'hooks', scope: 'user' }]), ['instructions', 'hooks', 'permissions'])
})

test('project, local and directory scope all count as the project', () => {
	assert.deepEqual(keys([{ kind: 'instructions', scope: 'directory' }, { kind: 'hooks', scope: 'local' }, { kind: 'permissions', scope: 'project' }]), [])
})

test('totals split into the project and the user', () => {
	const t = g.totalsBySource([
		{ kind: 'skills', scope: 'project' }, { kind: 'skills', scope: 'user' }, { kind: 'skills', scope: 'user' }, { kind: 'hooks', scope: 'local' },
	], ['skills', 'hooks', 'mcp'])
	assert.deepEqual(t, { project: { skills: 1, hooks: 1, mcp: 0 }, user: { skills: 2, hooks: 0, mcp: 0 } })
})

test('plurals', () => {
	assert.equal(g.plural(1, 'instruction'), '1 instruction')
	assert.equal(g.plural(2, 'instruction'), '2 instructions')
	assert.equal(g.plural(0, 'hook'), '0 hooks')
})

test('unused skills become a gap only once 30 days and a few sessions are covered', () => {
	assert.equal(g.unusedGap(['a'], 10, 9), undefined, 'not enough days')
	assert.equal(g.unusedGap(['a'], 40, 1), undefined, 'not enough sessions')
	assert.equal(g.unusedGap([], 40, 9), undefined)
	const gap = g.unusedGap(['a', 'b', 'c', 'd', 'e'], 30, 3)
	assert.equal(gap.key, 'unused')
	assert.equal(gap.cost, 0, 'a choice, not a fault: no points off')
	assert.match(gap.message, /5 skills not used in 30 days \(a, b, c, d and 1 more\)/)
})

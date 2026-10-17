// The effective configuration for one file (src/effective.ts): which instructions and rules stack for it, and which
// setting wins across managed / local / project / user.
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
	tmp = mkdtempSync(join(tmpdir(), 'flow-eff-'))
	const outfile = join(tmp, 'effective.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'effective.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	e = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const root = '/work/app'
const items = [
	{ kind: 'instructions', scope: 'project', label: 'CLAUDE.md', file: '/work/app/CLAUDE.md', agents: ['Claude'] },
	{ kind: 'instructions', scope: 'user', label: '~/.claude/CLAUDE.md', file: '/home/me/.claude/CLAUDE.md', agents: ['Claude'] },
	{ kind: 'instructions', scope: 'local', label: 'CLAUDE.local.md', file: '/work/app/CLAUDE.local.md', agents: ['Claude'] },
	{ kind: 'instructions', scope: 'directory', label: 'api/CLAUDE.md', file: '/work/app/api/CLAUDE.md', agents: ['Claude'] },
	{ kind: 'instructions', scope: 'directory', label: 'web/CLAUDE.md', file: '/work/app/web/CLAUDE.md', agents: ['Claude'] },
	{ kind: 'instructions', scope: 'directory', label: 'api/AGENTS.md', file: '/work/app/api/AGENTS.md', agents: ['Codex'] },
	{ kind: 'rules', scope: 'project', label: 'ts.md', file: '/work/app/.claude/rules/ts.md', agents: ['Claude'], paths: ['src/**/*.{ts,tsx}'] },
	{ kind: 'rules', scope: 'project', label: 'always.md', file: '/work/app/.claude/rules/always.md', agents: ['Claude'], paths: [] },
	{ kind: 'rules', scope: 'project', label: 'tests.md', file: '/work/app/.claude/rules/tests.md', agents: ['Claude'], paths: ['*.test.ts'] },
]

test('instructions stack widest first; a folder CLAUDE.md applies only under its folder', () => {
	const got = e.instructionsFor('/work/app/api/src/x.test.ts', root, items).filter(a => a.agent === 'Claude')
	assert.deepEqual(got.map(a => a.item.label), ['~/.claude/CLAUDE.md', 'CLAUDE.md', 'CLAUDE.local.md', 'api/CLAUDE.md', 'always.md', 'tests.md'])
	assert.equal(got.find(a => a.item.label === 'api/CLAUDE.md').when, 'on-demand')
	assert.equal(got.find(a => a.item.label === 'CLAUDE.md').when, 'always')
})

test('path-scoped rules match their globs, braces and bare names included', () => {
	const labels = f => e.instructionsFor(f, root, items).filter(a => a.item.kind === 'rules').map(a => a.item.label)
	assert.deepEqual(labels('/work/app/src/ui/a.tsx'), ['always.md', 'ts.md'])
	assert.deepEqual(labels('/work/app/README.md'), ['always.md'])
	assert.deepEqual(labels('/work/app/deep/x/y.test.ts'), ['always.md', 'tests.md'], 'a glob without a slash matches at any depth')
	assert.deepEqual(labels('/elsewhere/src/a.ts'), ['always.md'], 'a file outside the project gets no path-scoped rule')
})

test("Codex's nested AGENTS.md is named but not loaded from the root", () => {
	const got = e.instructionsFor('/work/app/api/x.ts', root, items).filter(a => a.agent === 'Codex')
	assert.equal(got.length, 1)
	assert.equal(got[0].when, 'not-loaded')
})

test('Windows paths compare without case', () => {
	const win = [{ kind: 'instructions', scope: 'directory', label: 'api/CLAUDE.md', file: 'C:\\Work\\App\\api\\CLAUDE.md', agents: ['Claude'] }]
	assert.equal(e.instructionsFor('c:\\work\\app\\API\\x.ts', 'c:\\work\\app', win).length, 1)
})

test('globList splits at commas outside braces and strips quotes', () => {
	assert.deepEqual(e.globList('src/**, "*.{ts,tsx}", \'docs/*.md\''), ['src/**', '*.{ts,tsx}', 'docs/*.md'])
	assert.deepEqual(e.globList('[a/**, b/**]'), ['a/**', 'b/**'])
})

test('scalar settings: managed over local over project over user; lists merge; deny from any scope is kept', () => {
	const eff = e.effectiveSettings([
		{ scope: 'user', file: 'u', data: { model: 'opus', permissions: { defaultMode: 'acceptEdits', allow: ['Bash(npm *)'] }, env: { A: '1', B: 'u' } } },
		{ scope: 'project', file: 'p', data: { model: 'sonnet', permissions: { deny: ['Bash(rm *)'] }, env: { B: 'p' } } },
		{ scope: 'local', file: 'l', data: { permissions: { defaultMode: 'plan', additionalDirectories: ['../lib'] } } },
		{ scope: 'managed', file: 'm', data: { model: 'haiku' } },
		{ scope: 'project', file: 'missing' },
	])
	const model = eff.scalars.find(s => s.key === 'model')
	assert.equal(model.value, 'haiku')
	assert.equal(model.scope, 'managed')
	assert.deepEqual(model.overridden.map(o => o.scope), ['project', 'user'])
	assert.equal(eff.mode, 'plan')
	assert.deepEqual(eff.rules.map(r => `${r.effect}:${r.pattern}:${r.scope}`), ['deny:Bash(rm *):project', 'allow:Bash(npm *):user'])
	assert.deepEqual(eff.env.map(v => `${v.key}=${v.value}@${v.scope}`), ['B=p@project', 'A=1@user'])
	assert.deepEqual(eff.additionalDirs, ['../lib'])
})

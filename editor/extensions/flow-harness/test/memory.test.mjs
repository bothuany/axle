// The agents' own memory, read only (src/memory.ts): the project key Claude Code files it under, the index and topic
// files, what a memory mentions, and how often it was recalled. Every fixture is synthetic.
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
	tmp = mkdtempSync(join(tmpdir(), 'flow-mem-'))
	const outfile = join(tmp, 'memory.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'memory.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	m = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('the project key: every character that is not a letter or digit becomes -', () => {
	assert.equal(m.projectKey(String.raw`C:\development\harness-flow`), 'C--development-harness-flow')
	assert.equal(m.projectKey(String.raw`C:\development\harness-flow\.claude\worktrees\happy-vaughan-5a93fe`), 'C--development-harness-flow--claude-worktrees-happy-vaughan-5a93fe')
	assert.equal(m.projectKey('/home/me/my_app.v2'), '-home-me-my-app-v2')
	assert.equal(m.projectKey('/Users/Ana María/code'), '-Users-Ana-Mar-a-code', 'non-ASCII letters too')
})

test('MEMORY.md index lines', () => {
	const idx = m.parseIndex('# Index\n- [No focus stealing](feedback_no-focus.md) — no global input\n* [Docs](reference_docs.md)\nprose\n')
	assert.deepEqual(idx, [
		{ title: 'No focus stealing', target: 'feedback_no-focus.md', hook: 'no global input', line: 1 },
		{ title: 'Docs', target: 'reference_docs.md', hook: '', line: 2 },
	])
})

test('a topic file: name, description, type and modified from metadata, and its body', () => {
	const x = m.parseMemory('/mem/feedback_x.md', '---\nname: feedback-x\ndescription: "Do not steal focus."\nmetadata:\n  node_type: memory\n  type: feedback\n  modified: 2026-10-10T09:57:46.626Z\n---\n\nRun in the background.\n\n**Why:** the user watches videos.\n')
	assert.equal(x.name, 'feedback-x')
	assert.equal(x.description, 'Do not steal focus.')
	assert.equal(x.type, 'feedback')
	assert.equal(x.modified, Date.parse('2026-10-10T09:57:46.626Z'))
	assert.match(x.body, /^Run in the background\./)
	const old = m.parseMemory('/mem/plain.md', '---\ntype: project\n---\nbody')
	assert.equal(old.type, 'project', 'a top-level type, as older files write it')
	assert.equal(old.name, 'plain')
	assert.equal(m.parseMemory('/mem/n.md', 'no frontmatter').type, undefined)
})

test('mentions: code-formatted names and paths, and only unmistakable ones in prose', () => {
	const x = m.mentions('Check `src/poly/graph.ts` and `Project.callers()` before `buildIndex`.\nThe `UserService` class and `npm test`. See docs/building.md, also https://x.dev/a/b.md.\nCall Flow.showEntry() when done. A sentence. Use `editor/vscode/`.')
	assert.deepEqual(x.paths.sort(), ['docs/building.md', 'editor/vscode/', 'src/poly/graph.ts'])
	assert.deepEqual(x.symbols.sort(), ['Flow.showEntry', 'Project.callers', 'UserService', 'buildIndex'])
	assert.deepEqual(m.mentions('Use `CLAUDE.md`, `README` and `x.json`; run `npm run arch`.').symbols, [], 'file names and commands are not code names')
})

test('promoting a memory gives one CLAUDE.md line with its why', () => {
	const x = m.parseMemory('/mem/f.md', '---\nname: f\ndescription: d\n---\nDo app work in the background.\n\n**Why:** the user watches videos.\n\n**How to apply:** use logs.')
	assert.equal(m.promotedLine(x), '- Do app work in the background. (Why: the user watches videos.)')
	assert.equal(m.promotedLine(m.parseMemory('/mem/g.md', '---\ndescription: Prefer npm over yarn.\n---\n')), '- Prefer npm over yarn.')
})

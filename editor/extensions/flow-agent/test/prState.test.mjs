// The PR of an agent's branch and its CI, from `gh pr view --json` (src/prState.ts).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let p
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-pr-'))
	const outfile = join(tmp, 'prState.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'prState.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	p = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

// Both shapes gh 2.x returns in statusCheckRollup.
const run = (name, status, conclusion) => ({ __typename: 'CheckRun', name, status, conclusion, workflowName: 'CI' })
const ctx = (context, state) => ({ __typename: 'StatusContext', context, state })
const pr = rollup => ({ number: 42, state: 'OPEN', isDraft: false, title: 'Dock improvements', url: 'https://github.com/o/r/pull/42', statusCheckRollup: rollup })

test('all green is pass, with the counts', () => {
	const r = p.parsePr(pr([run('build', 'COMPLETED', 'SUCCESS'), run('lint', 'COMPLETED', 'SKIPPED'), ctx('ci/legacy', 'SUCCESS')]))
	assert.equal(r.number, 42)
	assert.equal(r.state, 'open')
	assert.equal(r.checks, 'pass')
	assert.deepEqual(r.counts, { pass: 3, fail: 0, pending: 0 })
})

test('one failure in either shape fails, and is named', () => {
	const r = p.parsePr(pr([run('build', 'COMPLETED', 'SUCCESS'), run('test', 'COMPLETED', 'FAILURE'), run('test', 'COMPLETED', 'FAILURE'), ctx('deploy', 'ERROR'), run('slow', 'IN_PROGRESS', '')]))
	assert.equal(r.checks, 'fail')
	assert.deepEqual(r.failing, ['test', 'deploy'])
	assert.deepEqual(r.counts, { pass: 1, fail: 3, pending: 1 })
})

test('running or queued checks are pending', () => {
	assert.equal(p.parsePr(pr([run('build', 'QUEUED', ''), run('x', 'COMPLETED', 'SUCCESS')])).checks, 'pending')
	assert.equal(p.parsePr(pr([ctx('ci', 'PENDING')])).checks, 'pending')
})

test('no checks, drafts, merged and closed PRs', () => {
	assert.equal(p.parsePr(pr([])).checks, 'none')
	assert.equal(p.parsePr({ ...pr(null), isDraft: true }).state, 'draft')
	assert.equal(p.parsePr({ ...pr([]), state: 'MERGED' }).state, 'merged')
	assert.equal(p.parsePr({ ...pr([]), state: 'CLOSED' }).state, 'closed')
})

test('anything without a number or an https URL is no PR', () => {
	assert.equal(p.parsePr({}), undefined)
	assert.equal(p.parsePr(null), undefined)
	assert.equal(p.parsePr({ ...pr([]), url: 'javascript:alert(1)' }), undefined)
})

/** A fake `git` and `gh`: answers per command, and counts the calls. */
function fake(answers) {
	const calls = []
	const runner = async (cmd, args, cwd) => {
		calls.push([cmd, ...args].join(' '))
		const a = answers[cmd]
		if (a instanceof Error) {
			throw a
		}
		return typeof a === 'function' ? a(args, cwd) : a
	}
	return { calls, runner }
}

test('asked with an argument array, cached, and asked again only when stale', async () => {
	let now = 0
	const changed = []
	const f = fake({ git: 'feature/x\n', gh: JSON.stringify(pr([run('b', 'COMPLETED', 'SUCCESS')])) })
	const w = new p.PrWatcher(cwd => changed.push(cwd), f.runner, () => now)
	assert.equal(w.get('/repo'), undefined) // the first ask starts a fetch
	const r = await w.refresh('/repo') // shares the fetch already running
	assert.equal(r.number, 42)
	assert.deepEqual(f.calls, ['git rev-parse --abbrev-ref HEAD', `gh pr view --json ${p.PR_FIELDS}`])
	assert.deepEqual(changed, ['/repo'])
	now = 60_000
	assert.equal(w.get('/repo').number, 42)
	assert.equal(f.calls.length, 2, 'fresh: no new call')
	now = p.PR_TTL_MS + 1
	w.get('/repo')
	await w.refresh('/repo')
	assert.equal(f.calls.length, 4, 'stale: asked again')
	assert.deepEqual(changed, ['/repo'], 'the same answer is no change')
})

test('no gh, signed out, no PR or no git: silent', async () => {
	let now = 0
	const missing = fake({ git: 'main', gh: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) })
	const w1 = new p.PrWatcher(() => { }, missing.runner, () => now)
	assert.equal(await w1.refresh('/a'), undefined)
	now = 10 * p.PR_TTL_MS
	assert.equal(await w1.refresh('/b'), undefined)
	assert.equal(missing.calls.filter(c => c.startsWith('gh')).length, 1, 'gh is not looked for again')

	const out = fake({ git: 'main', gh: Object.assign(new Error('exit 4'), { code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' }) })
	const w2 = new p.PrWatcher(() => { }, out.runner, () => now)
	await w2.refresh('/a')
	now += p.PR_TTL_MS + 1
	await w2.refresh('/a')
	assert.equal(out.calls.filter(c => c.startsWith('gh')).length, 1, 'signed out: left alone for a while')

	const none = fake({ git: 'main', gh: Object.assign(new Error('exit 1'), { code: 1, stderr: 'no pull requests found for branch "main"' }) })
	assert.equal(await new p.PrWatcher(() => { }, none.runner, () => 0).refresh('/a'), undefined)

	const nogit = fake({ git: Object.assign(new Error('not a git repository'), { code: 128 }) })
	assert.equal(await new p.PrWatcher(() => { }, nogit.runner, () => 0).refresh('/a'), undefined)
	assert.equal(nogit.calls.length, 1)

	const detached = fake({ git: 'HEAD\n' })
	assert.equal(await new p.PrWatcher(() => { }, detached.runner, () => 0).refresh('/a'), undefined)
	assert.equal(detached.calls.length, 1, 'a detached HEAD has no PR to ask for')
})

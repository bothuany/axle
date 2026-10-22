// Merging, removing and letting go of an agent's worktree (src/worktreeFlow.ts), with scripted dialogs and git: what is
// asked, in which order, and that nothing changes the repository without a yes.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let w
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-wtflow-'))
	const outfile = join(tmp, 'worktreeFlow.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'worktreeFlow.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	w = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const WT = { path: '/r/.insilode/worktrees/claude-1', root: '/r', branch: 'insilode/claude-1', base: 'main' }
const AGENT = { name: 'Claude 2', live: false }

/** Dialogs that answer from a script, in order, and remember what was asked and said. */
function ui(...answers) {
	const asked = []
	const said = []
	return {
		asked, said,
		choose: async (message, detail, buttons) => { asked.push({ message, detail, buttons }); return answers.shift() },
		info: m => said.push(['info', m]),
		error: m => said.push(['error', m]),
	}
}

/** Git that answers from `o` and records what it was asked to change. */
function git(o = {}) {
	const plans = [...(o.plans ?? [{ kind: 'fast-forward', ahead: 1, uncommitted: 0 }])]
	const done = []
	return {
		done,
		planMerge: async () => plans.length > 1 ? plans.shift() : plans[0],
		merge: async (wt, kind) => { done.push(['merge', kind]); return o.mergeFails ? { ok: false, reason: 'boom' } : { ok: true } },
		changedFiles: async () => o.dirty,
		removeWorktree: async (wt, force) => { done.push(['remove', force]); const fail = o.removeFails?.shift(); return fail ? { ok: false, reason: fail } : { ok: true } },
		exists: async () => o.exists ?? true,
		sleep: async ms => { done.push(['sleep', ms]) },
	}
}

test('merge: asks, looks again after the yes, then merges', async () => {
	const u = ui('Merge')
	const g = git()
	assert.equal(await w.mergeFlow(AGENT, WT, u, g), 'merged')
	assert.match(u.asked[0].message, /Merge insilode\/claude-1 into main\?/)
	assert.match(u.asked[0].detail, /1 commit from Claude 2's worktree. Insilode will fast-forward main/)
	assert.deepEqual(g.done, [['merge', 'fast-forward']])
})

test('merge: nothing happens without a yes', async () => {
	const g = git()
	assert.equal(await w.mergeFlow(AGENT, WT, ui(undefined), g), 'cancelled')
	assert.deepEqual(g.done, [])
})

test('merge: the main checkout changed while the dialog was open, so it does not merge', async () => {
	const dirtyNow = git({ plans: [{ kind: 'fast-forward', ahead: 1, uncommitted: 0 }, { kind: 'refuse', reason: 'the main checkout has uncommitted changes (2 files).' }] })
	const u = ui('Merge')
	assert.equal(await w.mergeFlow(AGENT, WT, u, dirtyNow), 'refused')
	assert.deepEqual(dirtyNow.done, [])
	assert.match(u.said[0][1], /after all: the main checkout has uncommitted changes/)
	const moved = git({ plans: [{ kind: 'fast-forward', ahead: 1, uncommitted: 0 }, { kind: 'merge', ahead: 1, uncommitted: 0 }] })
	assert.equal(await w.mergeFlow(AGENT, WT, ui('Merge'), moved), 'cancelled', 'a fast-forward that became a merge commit is a different change')
	assert.deepEqual(moved.done, [])
})

test('merge: a refused plan is said, and uncommitted files are named in the question', async () => {
	const u = ui()
	assert.equal(await w.mergeFlow(AGENT, WT, u, git({ plans: [{ kind: 'refuse', reason: 'the main checkout is on dev, not main.' }] })), 'refused')
	assert.equal(u.asked.length, 0)
	const u2 = ui(undefined)
	await w.mergeFlow(AGENT, WT, u2, git({ plans: [{ kind: 'merge', ahead: 3, uncommitted: 2 }] }))
	assert.match(u2.asked[0].detail, /3 commits.*merge commit on main.*2 uncommitted files stay in the worktree/s)
	const u3 = ui('Merge')
	assert.equal(await w.mergeFlow(AGENT, WT, u3, git({ mergeFails: true })), 'failed')
	assert.match(u3.said[0][1], /failed: boom/)
})

test('remove: a clean worktree after one yes; a running agent is closed first', async () => {
	const g = git({ dirty: [] })
	let closed = 0
	assert.equal(await w.removeFlow({ name: 'Claude', live: true }, WT, ui('Remove'), g, () => closed++, 'linux'), 'removed')
	assert.equal(closed, 1)
	assert.deepEqual(g.done, [['sleep', 800], ['remove', false]])
})

test('remove: uncommitted work needs a second yes, and is then removed with force', async () => {
	const g = git({ dirty: ['a.ts', 'b.ts'] })
	const u = ui('Remove', undefined)
	assert.equal(await w.removeFlow(AGENT, WT, u, g, () => {}, 'linux'), 'cancelled')
	assert.match(u.asked[1].message, /2 uncommitted changes in the worktree will be lost/)
	assert.deepEqual(g.done, [], 'nothing removed on a no')
	const g2 = git({ dirty: ['a.ts'] })
	assert.equal(await w.removeFlow(AGENT, WT, ui('Remove', 'Remove and Lose Changes'), g2, () => {}, 'linux'), 'removed')
	assert.deepEqual(g2.done, [['remove', true]])
	const unknown = git({ dirty: undefined })
	const u3 = ui('Remove', undefined)
	await w.removeFlow(AGENT, WT, u3, unknown, () => {}, 'linux')
	assert.match(u3.asked[1].message, /could not read the worktree's status/)
})

test('remove: on Windows a busy folder is tried once more', async () => {
	const g = git({ dirty: [], removeFails: ['Permission denied'] })
	assert.equal(await w.removeFlow(AGENT, WT, ui('Remove'), g, () => {}, 'win32'), 'removed')
	assert.deepEqual(g.done, [['remove', false], ['sleep', 1500], ['remove', false]])
	const g2 = git({ dirty: [], removeFails: ['Permission denied', 'still'] })
	const u = ui('Remove')
	assert.equal(await w.removeFlow(AGENT, WT, u, g2, () => {}, 'linux'), 'failed', 'elsewhere it is not')
	assert.match(u.said[0][1], /could not remove the worktree: Permission denied/)
})

test('forget: an agent with a worktree on disk asks whether to keep, merge or remove it', async () => {
	const u = ui('Keep Worktree')
	assert.equal(await w.forgetFlow(AGENT, WT, u, git({ dirty: ['x'] })), 'keep')
	assert.deepEqual(u.asked[0].buttons, ['Keep Worktree', 'Merge…', 'Remove Worktree…'])
	assert.match(u.asked[0].detail, /1 uncommitted change/)
	assert.equal(await w.forgetFlow(AGENT, WT, ui('Remove Worktree…'), git({ dirty: [] })), 'remove')
	assert.equal(await w.forgetFlow(AGENT, WT, ui('Merge…'), git({ dirty: [] })), 'merge')
	assert.equal(await w.forgetFlow(AGENT, WT, ui(undefined), git({ dirty: [] })), 'cancelled', 'dismissing keeps the row')
	const none = ui()
	assert.equal(await w.forgetFlow(AGENT, undefined, none, git()), 'forget', 'no worktree: nothing to ask')
	assert.equal(await w.forgetFlow(AGENT, WT, none, git({ exists: false })), 'forget', 'a folder that is gone')
	assert.equal(none.asked.length, 0)
})

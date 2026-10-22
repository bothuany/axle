// The hook studio's verdict (src/hookverdict.ts): what Claude Code makes of a hook's exit code and output. JSON is read
// only on exit 0; exit 2 blocks whatever stdout says; any other exit is a non-blocking error.
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
	tmp = mkdtempSync(join(tmpdir(), 'flow-hooks-'))
	const outfile = join(tmp, 'hookverdict.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'hookverdict.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	m = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const J = o => JSON.stringify(o)
const pre = d => J({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d } })

test('exit code first, then the JSON decision on exit 0 only', () => {
	const rows = [
		// exit 0: the JSON decides, plain output passes
		[0, pre('allow'), 'allowed'],
		[0, pre('deny'), 'blocked'],
		[0, pre('ask'), 'asked'],
		[0, J({ decision: 'approve' }), 'allowed'],
		[0, J({ decision: 'block', reason: 'no' }), 'blocked'],
		[0, 'formatted 3 files', 'ok'],
		[0, '', 'ok'],
		[0, 'null', 'ok'],
		// exit 2 blocks, and no JSON can turn that into an approval
		[2, '', 'blocked'],
		[2, J({ decision: 'approve' }), 'blocked'],
		[2, pre('allow'), 'blocked'],
		// any other exit is an error that does not block; its stdout is not a decision
		[1, pre('allow'), 'failed'],
		[1, J({ decision: 'block' }), 'failed'],
		[127, '', 'failed'],
		[null, pre('deny'), 'failed'],
	]
	for (const [exit, stdout, want] of rows) {
		assert.equal(m.hookVerdict(exit, stdout), want, `exit ${exit}, stdout ${stdout || '(empty)'}`)
	}
})

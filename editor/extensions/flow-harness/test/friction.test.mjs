// The friction inbox's guard hooks (src/friction.ts): which command a guard stops, the script it writes and how it lands
// in the settings. The merged-main review found `cat foo|grep x` turning into a guard for every `cat foo …`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let f
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-friction-'))
	const outfile = join(tmp, 'friction.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'friction.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	f = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const fail = (subject, error = 'Error: ENOENT no such file', at = 1) => ({ tool: 'Bash', subject, error, at, cli: 'claude' })

test('a command head is the first command of a pipeline, its second word only when it is a plain word', () => {
	assert.equal(f.commandHead('cat foo|grep x'), 'cat foo')
	assert.equal(f.commandHead('cat foo | grep x'), 'cat foo')
	assert.equal(f.commandHead('npm test && npm run lint'), 'npm test')
	assert.equal(f.commandHead('git push --force'), 'git push')
	assert.equal(f.commandHead('NODE_ENV=x npm test'), 'npm test')
	assert.equal(f.commandHead('cat ./a.txt'), 'cat')
	assert.equal(f.commandHead('ls|wc -l'), 'ls')
	assert.equal(f.commandHead('for f in *; do x; done'), '')
	assert.equal(f.commandHead('(cd a && make)'), '')
})

test('failures group by tool, head and error, whatever characters the head holds', () => {
	const list = [fail('cat foo|grep x', 'Error: ENOENT', 1), fail('cat foo|grep y', 'Error: ENOENT', 2), fail('cat foo|grep z', 'Error: ENOENT', 3)]
	const [p] = f.failureProposals(list)
	assert.equal(p.kind, 'hook')
	assert.equal(p.prefix, 'cat foo', 'not cut at the pipe into a broader prefix')
})

test('a one-word head becomes an instruction, not a guard that would stop every use of the program', () => {
	const list = [fail('cat ./a', 'Error: x', 1), fail('cat ./b', 'Error: x', 2), fail('cat ./c', 'Error: x', 3)]
	assert.equal(f.failureProposals(list)[0].kind, 'instruction')
	const bare = [fail('make', 'Error: x', 1), fail('make', 'Error: x', 2), fail('make', 'Error: x', 3)]
	assert.equal(f.failureProposals(bare)[0].kind, 'hook', 'a program that failed run bare can be guarded')
})

test('the guard script stops the command in any part of a pipeline or list, and nothing else', () => {
	const file = join(tmp, 'guard.mjs')
	writeFileSync(file, f.guardScript('cat foo', 'Use the bar file.'))
	const run = command => spawnSync(process.execPath, [file], { input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' })
	for (const cmd of ['cat foo', 'cat foo|grep x', 'ls && cat foo -n', 'X=1 cat foo']) {
		const r = run(cmd)
		assert.equal(r.status, 2, cmd)
		assert.match(r.stderr, /Use the bar file/)
	}
	for (const cmd of ['cat foobar', 'cat bar', 'echo cat foo']) {
		assert.equal(run(cmd).status, 0, cmd)
	}
})

test('a second guard for the same command keeps one settings entry', () => {
	const s = {}
	const cmd = f.guardCommand(f.guardFileName('npm test'))
	f.addGuardHook(s, cmd)
	f.addGuardHook(s, cmd)
	assert.equal(s.hooks.PreToolUse.length, 1)
	assert.deepEqual(s.hooks.PreToolUse[0], { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/axle-guard-npm-test.mjs"', timeout: 10 }] })
	f.addGuardHook(s, f.guardCommand(f.guardFileName('git push')))
	assert.equal(s.hooks.PreToolUse.length, 2)
	const other = { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'x' }] }], Stop: [] } }
	f.addGuardHook(other, cmd)
	assert.equal(other.hooks.PreToolUse.length, 2, 'existing hooks stay')
	assert.deepEqual(other.hooks.Stop, [])
	assert.throws(() => f.addGuardHook({ hooks: [] }, cmd), /not an object/)
	assert.throws(() => f.addGuardHook({ hooks: { PreToolUse: {} } }, cmd), /not a list/)
})

test('an instruction line is appended, and a new file gets a heading', () => {
	assert.equal(f.appendInstruction('', '- Do not commit.'), '# Project instructions\n\n- Do not commit.\n')
	assert.equal(f.appendInstruction('# X\n', '- a'), '# X\n- a\n')
	assert.equal(f.appendInstruction('# X', '- a'), '# X\n- a\n')
})
